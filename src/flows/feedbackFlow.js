// Standalone "📝 Feedback" menu — staff pick an order that's "Out for
// Delivery"; picking one sends the customer a feedback request AND marks
// that order Delivered in the same step. Sending the request is treated as
// staff's confirmation that the customer actually has the order in hand —
// no separate "Mark Delivered" tap needed.

const { Scenes } = require('telegraf');
const ordersRepo = require('../repos/ordersRepo');
const keyboards = require('../keyboards');
const { step, callbackValue, leaveToMenu } = require('./common');
const { escapeMd, money } = require('../utils/format');
const { buildFeedbackWhatsAppLink } = require('../utils/feedback');

const feedbackWizard = new Scenes.WizardScene(
  'SEND_FEEDBACK',
  step(async (ctx) => {
    const orders = await ordersRepo.listOutForDelivery();
    if (!orders.length) {
      await leaveToMenu(ctx, 'No orders out for delivery right now — nothing to send feedback for yet.');
      return;
    }

    const list = orders
      .map((o, i) => {
        const itemDesc = o.Items.map((it) => it.ItemDesc).join(', ');
        return `*${i + 1}.* \`${o.OrderID}\` — ${escapeMd(o.CustomerName)}\n👟 ${escapeMd(itemDesc)} • ${money(o.Total)}`;
      })
      .join('\n\n');
    await ctx.reply(
      `📝 *Send Feedback Request*\n─────────────────\n${list}\n─────────────────\n` +
        `Which order has the customer actually received? Picking one sends the feedback\n` +
        `request and marks it *Delivered*.`,
      keyboards.outForDeliveryInlineKeyboard(orders)
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'fb_pick');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    const order = await ordersRepo.getOrderSummary(cb.value);
    if (!order) return ctx.reply('Order not found — please pick again, or Cancel and retry.');

    try {
      const feedbackWaLink = buildFeedbackWhatsAppLink(order.CustomerPhone, order.OrderID, order.CustomerName);
      await ctx.reply(
        `📝 Ask ${escapeMd(order.CustomerName)} how order \`${order.OrderID}\` went — one tap sends a WhatsApp message with their feedback form link:`,
        keyboards.waLinkKeyboard('📝 Send Feedback Request', feedbackWaLink)
      );
    } catch (err) {
      // Most likely cause: FEEDBACK_FORM_BASE_URL / FEEDBACK_FORM_ORDER_ID_ENTRY
      // not set yet — see utils/feedback.js and .env.example. The order is
      // NOT marked Delivered below in this case — better to retry once the
      // form is configured than silently lose the feedback step.
      console.error(`Feedback link generation failed for order ${order.OrderID}:`, err);
      await ctx.reply('⚠️ The feedback form is not configured yet — ask the owner to run `npm run setup-feedback-form`.');
      return ctx.scene.leave();
    }

    // Sending the feedback request is what confirms the order is actually
    // delivered — flip every row of this (possibly multi-item) order now.
    await ordersRepo.markDelivered(order.OrderID);
    await ctx.reply(`✅ Order \`${order.OrderID}\` marked *Delivered*.`);

    return ctx.scene.leave();
  })
);

module.exports = { feedbackWizard };
