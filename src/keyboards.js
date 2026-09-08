// All reusable keyboards in one place, so the "shape" of the bot's menus is
// easy to see and tweak without hunting through flow files.

const { Markup } = require('telegraf');
const { ROLES, can } = require('./permissions');

// Persistent reply keyboard — always visible under the text box. Built per
// role so a Staff member never sees a "📣 Marketing" button they'd just get
// turned away from, and vice versa for a Marketing-only user. Owner sees
// everything, including "👤 Add User".
function mainMenuFor(role) {
  const rows = [];

  const row1 = [];
  if (can(role, 'inventory')) row1.push('📦 Inventory');
  if (can(role, 'orders')) row1.push('🛒 New Order');
  if (row1.length) rows.push(row1);

  const row2 = [];
  if (can(role, 'deliveries')) row2.push('🚚 Log Delivery');
  if (can(role, 'marketing')) row2.push('📣 Marketing');
  if (row2.length) rows.push(row2);

  const row3 = [];
  if (can(role, 'dashboard')) row3.push('📊 Dashboard');
  if (can(role, 'feedback')) row3.push('📝 Feedback');
  if (row3.length) rows.push(row3);

  const row4 = [];
  if (can(role, 'users')) row4.push('👤 Add User');
  if (row4.length) rows.push(row4);

  return Markup.keyboard(rows).resize();
}

/** Role picker for the "👤 Add User" flow. */
const roleKeyboard = Markup.keyboard([[ROLES.OWNER, ROLES.STAFF], [ROLES.MARKETING], ['❌ Cancel']]).resize();

const inventoryMenu = Markup.keyboard([
  ['➕ Add New Item', '🔁 Restock Existing'],
  ['⬅️ Back to Menu'],
]).resize();

const cancelKeyboard = Markup.keyboard([['❌ Cancel']]).resize();

const yesNoKeyboard = Markup.keyboard([['✅ Yes', '❌ No, cancel']]).resize();

/** Shown after each item is added to a new order — keep building the cart or move to checkout. */
const addAnotherItemKeyboard = Markup.keyboard([['➕ Add Another Item', '✅ Done — Checkout'], ['❌ Cancel']]).resize();

const deliveryMethodKeyboard = Markup.keyboard([['🚌 Bus', '🚕 Taxi'], ['❌ Cancel']]).resize();

const platformKeyboard = Markup.keyboard([['📸 Instagram', '📘 Facebook'], ['🎵 TikTok'], ['❌ Cancel']]).resize();

const postDateKeyboard = Markup.keyboard([['📅 Today'], ['❌ Cancel']]).resize();

/** Cancel + Skip, for the optional fields (reach, engagement, notes). */
const skipKeyboard = Markup.keyboard([['⏭️ Skip'], ['❌ Cancel']]).resize();

/** Common Bhutan sneaker sizes as quick-pick buttons — staff can still type any size. */
const commonSizes = ['38', '39', '40', '41', '42', '43', '44'];
function sizeKeyboard() {
  const rows = [];
  for (let i = 0; i < commonSizes.length; i += 4) {
    rows.push(commonSizes.slice(i, i + 4));
  }
  rows.push(['❌ Cancel']);
  return Markup.keyboard(rows).resize();
}

/** Bhutanese banks — edit this list to match the accounts you actually hold. */
const bhutaneseBanks = ['Bank of Bhutan (BoB)', 'Bhutan National Bank (BNB)', 'Druk PNB Bank (DPNB)', 'T Bank (TBank)', 'BDBL', 'DK Bank'];
function bankKeyboard() {
  const rows = [];
  for (let i = 0; i < bhutaneseBanks.length; i += 2) {
    rows.push(bhutaneseBanks.slice(i, i + 2));
  }
  rows.push(['Other (type it)'], ['❌ Cancel']);
  return Markup.keyboard(rows).resize();
}

/** Builds an inline keyboard listing brands (one per row is easiest to tap on mobile). */
function brandInlineKeyboard(brands, callbackPrefix) {
  const buttons = brands.map((b) => [Markup.button.callback(`🏷️ ${b}`, `${callbackPrefix}:${b}`)]);
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  return Markup.inlineKeyboard(buttons);
}

/** Builds an inline keyboard listing inventory items with stock counts. */
function itemInlineKeyboard(items, callbackPrefix) {
  const buttons = items.map((item) => [
    Markup.button.callback(
      `👟 ${item.Name} • ${item.Size} • ${item.Color} (${item.Quantity} left)`,
      `${callbackPrefix}:${item.ItemID}`
    ),
  ]);
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  return Markup.inlineKeyboard(buttons);
}

/** Builds the "which period?" picker shown before the dashboard is computed. */
function periodInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Today', 'dperiod:today')],
    [Markup.button.callback('🗓️ This Week', 'dperiod:week')],
    [Markup.button.callback('📆 This Month', 'dperiod:month')],
    [Markup.button.callback('♾️ All Time', 'dperiod:all')],
    [Markup.button.callback('❌ Cancel', 'cancel')],
  ]);
}

/**
 * Builds an inline keyboard listing recent pending orders, for the delivery
 * flow. Each button is numbered to match the detailed, numbered order list
 * sent as text right above it (see deliveryFlow.js) — so the full details
 * (order ID, item, qty/price, destination) live where there's room to read
 * them, and the button itself only needs to be short enough to tap
 * reliably: a number plus the customer's name.
 */
function orderInlineKeyboard(orders) {
  const buttons = orders.map((o, i) => [
    Markup.button.callback(`${i + 1}. ${o.CustomerName}`, `pick_order:${o.OrderID}`),
  ]);
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  return Markup.inlineKeyboard(buttons);
}

/**
 * Builds an inline keyboard listing orders "Out for Delivery", for the
 * standalone "📝 Feedback" menu (see flows/feedbackFlow.js) — picking one
 * sends the feedback request AND marks that order Delivered in one step.
 * Separate callback prefix from orderInlineKeyboard's "pick_order" (used by
 * the Log Delivery flow) so the two never collide.
 */
function outForDeliveryInlineKeyboard(orders) {
  const buttons = orders.map((o, i) => [
    Markup.button.callback(`${i + 1}. ${o.CustomerName}`, `fb_pick:${o.OrderID}`),
  ]);
  buttons.push([Markup.button.callback('❌ Cancel', 'cancel')]);
  return Markup.inlineKeyboard(buttons);
}

/**
 * Generic single URL button — e.g. the "📝 Send Feedback Request" wa.me
 * button. A URL button opens directly (no callback round-trip, no
 * answerCbQuery needed), same as tapping a plain link in the message text,
 * just rendered as a tappable button instead.
 */
function waLinkKeyboard(label, url) {
  return Markup.inlineKeyboard([[Markup.button.url(label, url)]]);
}

module.exports = {
  mainMenuFor,
  inventoryMenu,
  cancelKeyboard,
  yesNoKeyboard,
  addAnotherItemKeyboard,
  deliveryMethodKeyboard,
  platformKeyboard,
  postDateKeyboard,
  skipKeyboard,
  roleKeyboard,
  sizeKeyboard,
  bankKeyboard,
  periodInlineKeyboard,
  brandInlineKeyboard,
  itemInlineKeyboard,
  orderInlineKeyboard,
  outForDeliveryInlineKeyboard,
  waLinkKeyboard,
};
