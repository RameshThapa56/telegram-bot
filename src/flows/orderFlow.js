const { Scenes } = require('telegraf');
const inventoryRepo = require('../repos/inventoryRepo');
const ordersRepo = require('../repos/ordersRepo');
const keyboards = require('../keyboards');
const { step, textInput, callbackValue, leaveToMenu } = require('./common');
const { parseNumber, money, escapeMd, orderMessage } = require('../utils/format');
const { isPlausiblePhone, formatForDisplay } = require('../utils/phone');
const { buildWhatsAppLink /* , buildSmsLink */ } = require('../utils/links');

/** The step index that starts item selection (choose brand) — jumped back to
 * from the "Add Another Item?" prompt so the wizard loops without repeating
 * the whole scene. Update this if steps are reordered above it. */
const PICK_BRAND_STEP = 1;

function cartLineDesc(line) {
  return `${line.item.Brand} ${line.item.Name} (${line.item.Size}, ${line.item.Color})`;
}

function cartTotal(cart) {
  return cart.reduce((sum, line) => sum + line.qty * line.price, 0);
}

/** Sends the brand list — shared by the scene's entry step and the "Add
 * Another Item" loop, which both need to re-show it. */
async function promptBrand(ctx) {
  const brands = await inventoryRepo.listBrands();
  if (!brands.length) {
    await leaveToMenu(ctx, 'No inventory yet — add items first with "📦 Inventory → ➕ Add New Item".');
    return false;
  }
  await ctx.reply('Which brand?', keyboards.brandInlineKeyboard(brands, 'obrand'));
  return true;
}

/** Sends the "confirm order" summary — shared by the Cash and Bank Transfer branches, which arrive here after collecting different fields. */
async function showOrderConfirmation(ctx) {
  const o = ctx.wizard.state.order;
  const cart = ctx.wizard.state.cart;
  const lines = cart
    .map(
      (line) =>
        `${escapeMd(cartLineDesc(line))}\nQty: ${line.qty} × ${money(line.price)} = *${money(line.qty * line.price)}*`
    )
    .join('\n\n');
  const paymentLine = `Payment: 🏦 ${escapeMd(o.bankName)} • Journal #${escapeMd(o.journalNumber)}`;
  await ctx.reply(
    `📋 *Confirm order*\n─────────────────\n${lines}\n─────────────────\n` +
      `*Order Total: ${money(cartTotal(cart))}*\n` +
      `Deliver to: ${escapeMd(o.deliveryLocation)}\n` +
      `Customer: ${escapeMd(o.customerName)} (${escapeMd(formatForDisplay(o.customerPhone))})\n` +
      `${paymentLine}\n─────────────────\n` +
      `Save this order?`,
    keyboards.yesNoKeyboard
  );
}

const orderWizard = new Scenes.WizardScene(
  'NEW_ORDER',
  step(async (ctx) => {
    ctx.wizard.state.order = {};
    ctx.wizard.state.cart = [];
    await ctx.reply('🛒 *New Order*\n─────────────────');
    if (!(await promptBrand(ctx))) return;
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'obrand');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    const items = (await inventoryRepo.listByBrand(cb.value)).filter((i) => Number(i.Quantity) > 0);
    if (!items.length) {
      await leaveToMenu(ctx, `No ${cb.value} items currently in stock.`);
      return;
    }
    ctx.wizard.state.items = items;
    await ctx.reply('Which item?', keyboards.itemInlineKeyboard(items, 'oitem'));
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'oitem');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    const item = ctx.wizard.state.items.find((i) => i.ItemID === cb.value);
    if (!item) return ctx.reply('Please pick an item from the list.');

    ctx.wizard.state.item = item;
    await ctx.reply(
      `👟 *${escapeMd(item.Name)}* • ${escapeMd(item.Size)} • ${escapeMd(item.Color)}\nIn stock: ${item.Quantity}\n\nHow many pairs?`,
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const qty = parseNumber(textInput(ctx));
    const item = ctx.wizard.state.item;
    if (qty === null || qty <= 0) return ctx.reply('Please enter a valid positive number.');

    const alreadyInCart = ctx.wizard.state.cart
      .filter((line) => line.item.ItemID === item.ItemID)
      .reduce((sum, line) => sum + line.qty, 0);
    if (qty + alreadyInCart > Number(item.Quantity)) {
      const remaining = Number(item.Quantity) - alreadyInCart;
      return ctx.reply(
        remaining > 0
          ? `Only ${remaining} more in stock for this item (some are already in this order). Enter a smaller quantity.`
          : `You've already added all ${item.Quantity} in stock for this item.`
      );
    }

    ctx.wizard.state.pendingQty = qty;
    await ctx.reply(
      `💵 Price per pair, in Nu.? _(usual selling price is ${money(item.SellPrice)})_`,
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const price = parseNumber(textInput(ctx));
    if (price === null || price < 0) return ctx.reply('Please enter a valid number for price.');

    const item = ctx.wizard.state.item;
    const qty = ctx.wizard.state.pendingQty;
    ctx.wizard.state.cart.push({ item, qty, price });
    ctx.wizard.state.item = null;
    ctx.wizard.state.pendingQty = null;

    const cart = ctx.wizard.state.cart;
    const summary = cart
      .map((line) => `• ${escapeMd(cartLineDesc(line))} — ${line.qty} × ${money(line.price)}`)
      .join('\n');
    await ctx.reply(
      `🛒 *Order so far*\n─────────────────\n${summary}\n─────────────────\n` +
        `Subtotal: *${money(cartTotal(cart))}*\n\nAdd another item, or check out?`,
      keyboards.addAnotherItemKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text === '➕ Add Another Item') {
      if (!(await promptBrand(ctx))) return;
      ctx.wizard.selectStep(PICK_BRAND_STEP);
      return;
    }
    if (text !== '✅ Done — Checkout') {
      return ctx.reply('Please choose an option below.', keyboards.addAnotherItemKeyboard);
    }

    await ctx.reply('📍 Delivery location? _(type it — e.g. "Thimphu, Olakha")_', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const location = textInput(ctx);
    if (!location) return ctx.reply('Please type the delivery location.');

    ctx.wizard.state.order.deliveryLocation = location;
    await ctx.reply("🙋 Customer's name?", keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const name = textInput(ctx);
    if (!name) return ctx.reply('Please type the customer name.');

    ctx.wizard.state.order.customerName = name;
    await ctx.reply("📱 Customer's phone number? _(e.g. 17123456)_", keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const phone = textInput(ctx);
    if (!phone || !isPlausiblePhone(phone)) return ctx.reply('Please enter a valid phone number.');

    ctx.wizard.state.order.customerPhone = phone;
    // Payment is always a digital/bank transfer for this shop — no cash
    // option to ask about, straight to which bank it went into.
    ctx.wizard.state.order.paymentMethod = 'Bank Transfer';
    await ctx.reply('🏦 Which bank did the customer pay into?', keyboards.bankKeyboard());
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const bank = textInput(ctx);
    if (!bank || bank === 'Other (type it)') return ctx.reply('Please pick or type the bank name.');

    ctx.wizard.state.order.bankName = bank;
    await ctx.reply('🧾 Journal number for the transfer?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const journalNumber = textInput(ctx);
    if (!journalNumber) return ctx.reply('Please enter the journal number.');

    ctx.wizard.state.order.journalNumber = journalNumber;
    await showOrderConfirmation(ctx);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text !== '✅ Yes') return leaveToMenu(ctx, '🚫 Not saved. Back to the main menu.');

    const o = ctx.wizard.state.order;
    const cart = ctx.wizard.state.cart;

    const { OrderID, Total } = await ordersRepo.create({
      items: cart.map((line) => ({
        itemId: line.item.ItemID,
        itemDesc: cartLineDesc(line),
        qty: line.qty,
        price: line.price,
      })),
      deliveryLocation: o.deliveryLocation,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      paymentMethod: o.paymentMethod,
      bankName: o.bankName,
      journalNumber: o.journalNumber,
      createdBy: ctx.from.username || ctx.from.first_name || String(ctx.from.id),
    });
    await Promise.all(cart.map((line) => inventoryRepo.decrementQuantity(line.item.ItemID, line.qty)));

    const orderForMessage = {
      OrderID,
      Total,
      Items: cart.map((line) => ({ ItemDesc: cartLineDesc(line), Qty: line.qty })),
      DeliveryLocation: o.deliveryLocation,
      CustomerName: o.customerName,
    };
    const message = orderMessage(orderForMessage);
    const waLink = buildWhatsAppLink(o.customerPhone, message);
    // const smsLink = buildSmsLink(o.customerPhone, message); // SMS disabled for now — WhatsApp only

    await ctx.reply(
      `✅ *Order \`${OrderID}\` saved!* Total: *${money(Total)}*\n─────────────────\n` +
        `Tap the link below to notify the customer:\n\n` +
        `💬 WhatsApp:\n${waLink}`,
      keyboards.mainMenuFor(ctx.state.role)
    );
    return ctx.scene.leave();
  })
);

module.exports = { orderWizard };
