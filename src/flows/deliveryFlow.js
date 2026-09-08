const { Scenes } = require('telegraf');
const ordersRepo = require('../repos/ordersRepo');
const deliveriesRepo = require('../repos/deliveriesRepo');
const keyboards = require('../keyboards');
const { step, textInput, callbackValue, leaveToMenu } = require('./common');
const { parseNumber, money, escapeMd, driverMessage, customerDeliveryMessage, invoiceMessage } = require('../utils/format');
const { isPlausiblePhone, formatForDisplay } = require('../utils/phone');
const { buildWhatsAppLink /* , buildSmsLink */ } = require('../utils/links');
const { buildInvoicePdf } = require('../utils/invoicePdf');

const deliveryWizard = new Scenes.WizardScene(
  'LOG_DELIVERY',
  step(async (ctx) => {
    ctx.wizard.state.delivery = {};
    const orders = await ordersRepo.listPending();
    if (!orders.length) {
      await leaveToMenu(ctx, 'No pending orders to deliver right now.');
      return;
    }

    // Full details as numbered text — buttons below only need to carry a
    // number + customer name, so this is what actually tells orders apart
    // when several are pending at once.
    const list = orders
      .map((o, i) => {
        const itemLines = o.Items.map((it) => `👟 ${escapeMd(it.ItemDesc)} — ${it.Qty} x ${money(it.Price)}`).join('\n');
        return (
          `*${i + 1}.* \`${o.OrderID}\` — ${escapeMd(o.CustomerName)}\n` +
          `${itemLines}\n` +
          `Total: ${money(o.Total)} • 📍 ${escapeMd(o.DeliveryLocation)}`
        );
      })
      .join('\n\n');
    await ctx.reply(
      `🚚 *Log Delivery*\n─────────────────\n${list}\n─────────────────\nWhich order is this delivery for?`,
      keyboards.orderInlineKeyboard(orders)
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'pick_order');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    const order = await ordersRepo.getOrderSummary(cb.value);
    if (!order) return ctx.reply('Order not found — please pick again, or Cancel and retry.');

    ctx.wizard.state.order = order;
    const paymentLine =
      order.PaymentMethod === 'Bank Transfer'
        ? `💳 ${escapeMd(order.BankName)} • Journal #${escapeMd(order.JournalNumber)}`
        : `💳 ${escapeMd(order.PaymentMethod || 'Cash')}`;
    const itemLines = order.Items.map((it) => `👟 ${escapeMd(it.ItemDesc)} — ${it.Qty} x ${money(it.Price)}`).join('\n');
    await ctx.reply(
      `📦 *Order* \`${order.OrderID}\`\n─────────────────\n` +
        `🙋 ${escapeMd(order.CustomerName)} (${escapeMd(formatForDisplay(order.CustomerPhone))})\n` +
        `${itemLines}\n` +
        `Total: *${money(order.Total)}*\n` +
        `📍 ${escapeMd(order.DeliveryLocation)}\n` +
        `${paymentLine}\n─────────────────\n` +
        `*Delivery method?*`,
      keyboards.deliveryMethodKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    const method = text === '🚌 Bus' ? 'Bus' : text === '🚕 Taxi' ? 'Taxi' : null;
    if (!method) return ctx.reply('Please choose *Bus* or *Taxi*.');

    ctx.wizard.state.delivery.method = method;
    await ctx.reply(
      method === 'Bus' ? '🚌 Bus name/number? _(or type "N/A")_' : '🚕 Taxi vehicle plate number?',
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const plate = textInput(ctx);
    if (!plate) return ctx.reply('Please type the vehicle/plate info.');

    ctx.wizard.state.delivery.vehiclePlate = plate;
    await ctx.reply("📱 Driver's phone number?", keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const phone = textInput(ctx);
    if (!phone || !isPlausiblePhone(phone)) return ctx.reply('Please enter a valid phone number.');

    ctx.wizard.state.delivery.driverPhone = phone;
    await ctx.reply('💵 Delivery charge, in Nu.?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const charge = parseNumber(textInput(ctx));
    if (charge === null || charge < 0) return ctx.reply('Please enter a valid number.');

    ctx.wizard.state.delivery.deliveryCharge = charge;
    const d = ctx.wizard.state.delivery;
    const order = ctx.wizard.state.order;
    const itemLines = order.Items.map((it) => `${escapeMd(it.ItemDesc)}\n${it.Qty} x ${money(it.Price)} = ${money(it.Total)}`).join(
      '\n\n'
    );
    await ctx.reply(
      `📋 *Confirm delivery*\n─────────────────\n` +
        `Order: \`${order.OrderID}\`\n\n` +
        `*Customer*\n` +
        `${escapeMd(order.CustomerName)}\n` +
        `${escapeMd(formatForDisplay(order.CustomerPhone))}\n\n` +
        `*Items*\n` +
        `${itemLines}\n\n` +
        `*Total: ${money(order.Total)}*\n\n` +
        `*Delivery*\n` +
        `Method: *${d.method}* (${escapeMd(d.vehiclePlate)})\n` +
        `Driver: ${escapeMd(formatForDisplay(d.driverPhone))}\n` +
        `Charge: *${money(d.deliveryCharge)}*\n` +
        `To: ${escapeMd(order.DeliveryLocation)}\n─────────────────\n` +
        `Save this delivery?`,
      keyboards.yesNoKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text !== '✅ Yes') return leaveToMenu(ctx, '🚫 Not saved. Back to the main menu.');

    const d = ctx.wizard.state.delivery;
    const order = ctx.wizard.state.order;

    const deliveryId = await deliveriesRepo.create({
      orderId: order.OrderID,
      method: d.method,
      vehiclePlate: d.vehiclePlate,
      driverPhone: d.driverPhone,
      deliveryCharge: d.deliveryCharge,
      createdBy: ctx.from.username || ctx.from.first_name || String(ctx.from.id),
    });

    const driverMsg = driverMessage(d, order);
    const driverWaLink = buildWhatsAppLink(d.driverPhone, driverMsg);
    // const driverSmsLink = buildSmsLink(d.driverPhone, driverMsg); // SMS disabled for now — WhatsApp only

    const customerMsg = customerDeliveryMessage(d, order);
    const customerWaLink = buildWhatsAppLink(order.CustomerPhone, customerMsg);
    // const customerSmsLink = buildSmsLink(order.CustomerPhone, customerMsg); // SMS disabled for now — WhatsApp only

    await ctx.reply(
      `✅ *Delivery \`${deliveryId}\` logged* for order \`${order.OrderID}\`\n─────────────────\n` +
        `*Notify the driver*\n💬 WhatsApp: ${driverWaLink}\n\n` +
        `*Notify the customer*\n💬 WhatsApp: ${customerWaLink}`,
      keyboards.mainMenuFor(ctx.state.role)
    );

    // Branded PDF invoice — opens as a proper document preview in WhatsApp
    // instead of a wall of text. Tap ⋮ (or long-press) on it in Telegram to
    // forward it straight to the customer's WhatsApp chat.
    try {
      const pdfBuffer = await buildInvoicePdf(order, d);
      await ctx.replyWithDocument(
        { source: pdfBuffer, filename: `Invoice-${order.OrderID}.pdf` },
        { caption: `🧾 Invoice for order \`${order.OrderID}\` — forward this to the customer on WhatsApp.` }
      );
    } catch (err) {
      console.error('Invoice PDF generation failed, falling back to text:', err);
      const invoiceMsg = invoiceMessage(order, d);
      const invoiceWaLink = buildWhatsAppLink(order.CustomerPhone, invoiceMsg);
      await ctx.reply(`🧾 *Send the invoice*\n💬 WhatsApp: ${invoiceWaLink}`);
    }

    return ctx.scene.leave();
  })
);

module.exports = { deliveryWizard };
