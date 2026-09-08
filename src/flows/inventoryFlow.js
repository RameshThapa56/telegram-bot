// Two wizards: adding a brand-new SKU, and restocking one that already
// exists. Kept separate (rather than one flow that "guesses") because the
// data staff need to enter is genuinely different — new items need prices,
// restocks just need a quantity — and forcing a single form invites mistakes.

const { Scenes } = require('telegraf');
const inventoryRepo = require('../repos/inventoryRepo');
const keyboards = require('../keyboards');
const { step, textInput, callbackValue, leaveToMenu } = require('./common');
const { parseNumber, money, escapeMd } = require('../utils/format');

// ---------- Add New Item ----------

const addItemWizard = new Scenes.WizardScene(
  'ADD_ITEM',
  step(async (ctx) => {
    ctx.wizard.state.item = {};
    const brands = await inventoryRepo.listBrands();
    await ctx.reply(
      "➕ *Add New Item*\n─────────────────\nPick an existing brand, or just type a new brand name:",
      brands.length ? keyboards.brandInlineKeyboard(brands, 'brand') : keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'brand');
    const brand = cb ? (cb.cancelled ? null : cb.value) : textInput(ctx);
    if (cb && cb.cancelled) return leaveToMenu(ctx);
    if (!brand) return ctx.reply('Please pick a brand button or type a brand name.');

    ctx.wizard.state.item.brand = brand;
    await ctx.reply(
      `Brand: *${escapeMd(brand)}*\n\nWhat's the shoe/model name? _(e.g. "Air Max 90")_`,
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const name = textInput(ctx);
    if (!name) return ctx.reply('Please type the item name as text.');

    ctx.wizard.state.item.name = name;
    await ctx.reply('📏 What size? _(EU size, e.g. 42)_', keyboards.sizeKeyboard());
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const size = textInput(ctx);
    if (!size) return ctx.reply('Please pick a size button or type a size.');

    ctx.wizard.state.item.size = size;
    await ctx.reply('🎨 What color?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const color = textInput(ctx);
    if (!color) return ctx.reply('Please type the color as text.');

    ctx.wizard.state.item.color = color;

    const existing = await inventoryRepo.findExact(ctx.wizard.state.item);
    if (existing) {
      await leaveToMenu(
        ctx,
        `⚠️ That exact item already exists as \`${existing.ItemID}\` with ${existing.Quantity} in stock.\n` +
          `Use "🔁 Restock Existing" instead to add more of it.`
      );
      return;
    }

    await ctx.reply('🔢 How many pairs are you adding? _(quantity)_', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const qty = parseNumber(textInput(ctx));
    if (qty === null || qty <= 0) return ctx.reply('Please enter a valid positive number for quantity.');

    ctx.wizard.state.item.quantity = qty;
    await ctx.reply('💵 What is your cost price per pair, in Nu.?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cost = parseNumber(textInput(ctx));
    if (cost === null || cost < 0) return ctx.reply('Please enter a valid number for cost price.');

    ctx.wizard.state.item.costPrice = cost;
    await ctx.reply('🏷️ What is your selling price per pair, in Nu.?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const sell = parseNumber(textInput(ctx));
    if (sell === null || sell < 0) return ctx.reply('Please enter a valid number for selling price.');

    ctx.wizard.state.item.sellPrice = sell;
    const it = ctx.wizard.state.item;
    await ctx.reply(
      `📋 *Confirm new item*\n─────────────────\n` +
        `Brand: *${escapeMd(it.brand)}*\nModel: ${escapeMd(it.name)}\nSize: ${escapeMd(it.size)}\nColor: ${escapeMd(it.color)}\n` +
        `Quantity: ${it.quantity}\nCost: ${money(it.costPrice)}\nSell: *${money(it.sellPrice)}*\n─────────────────\n` +
        `Save this item?`,
      keyboards.yesNoKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text !== '✅ Yes') return leaveToMenu(ctx, '🚫 Not saved. Back to the main menu.');

    const itemId = await inventoryRepo.addNewItem(ctx.wizard.state.item);
    await ctx.reply(`✅ *Saved!* New item ID: \`${itemId}\``, keyboards.mainMenuFor(ctx.state.role));
    return ctx.scene.leave();
  })
);

// ---------- Restock Existing ----------

const restockWizard = new Scenes.WizardScene(
  'RESTOCK_ITEM',
  step(async (ctx) => {
    const brands = await inventoryRepo.listBrands();
    if (!brands.length) {
      await leaveToMenu(ctx, 'No inventory yet — add an item first with "➕ Add New Item".');
      return;
    }
    await ctx.reply('🔁 *Restock Existing*\n─────────────────\nWhich brand are you restocking?', keyboards.brandInlineKeyboard(brands, 'rbrand'));
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'rbrand');
    if (!cb) return; // ignore unrelated updates
    if (cb.cancelled) return leaveToMenu(ctx);

    const items = await inventoryRepo.listByBrand(cb.value);
    if (!items.length) {
      await leaveToMenu(ctx, `No items found for ${cb.value}.`);
      return;
    }
    ctx.wizard.state.items = items;
    await ctx.reply('Which item?', keyboards.itemInlineKeyboard(items, 'ritem'));
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'ritem');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    const item = ctx.wizard.state.items.find((i) => i.ItemID === cb.value);
    if (!item) return ctx.reply('Please pick an item from the list.');

    ctx.wizard.state.item = item;
    await ctx.reply(
      `👟 *${escapeMd(item.Name)}* • ${escapeMd(item.Size)} • ${escapeMd(item.Color)}\nCurrent stock: ${item.Quantity}\n\n` +
        `How many pairs are you adding?`,
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const qty = parseNumber(textInput(ctx));
    if (qty === null || qty <= 0) return ctx.reply('Please enter a valid positive number.');

    const newQty = await inventoryRepo.restock(ctx.wizard.state.item.ItemID, qty);
    await ctx.reply(
      `✅ *Restocked.* ${escapeMd(ctx.wizard.state.item.Name)} (${escapeMd(ctx.wizard.state.item.Size)}, ${escapeMd(ctx.wizard.state.item.Color)}) ` +
        `now has *${newQty}* in stock.`,
      keyboards.mainMenuFor(ctx.state.role)
    );
    return ctx.scene.leave();
  })
);

module.exports = { addItemWizard, restockWizard };
