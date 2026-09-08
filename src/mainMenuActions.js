// Single source of truth for "what does this main-menu/submenu button do".
// Used two ways:
//   1. bot.js registers these as top-level bot.hears() handlers.
//   2. common.js's step() checks incoming text against these on every wizard
//      step, so tapping a menu button always escapes a stuck/abandoned scene
//      instead of being swallowed as invalid input for whatever step happens
//      to be active — see the "stuck on choose delivery method" bug.
//
// Every entry carries a `permission` key (see src/permissions.js) that's
// checked at call time — not just at keyboard-build time. keyboards.js's
// mainMenuFor(role) already hides buttons a role can't use, but this is the
// actual enforcement: someone typing a hidden command by hand (or a stale
// keyboard from before a role change) gets turned away here instead of the
// action running.
//
// Handlers are wired in lazily (via requireBot()) to avoid a require cycle
// with bot.js / dashboard.js / flows.

const { can } = require('./permissions');

let deps = null;
function requireDeps() {
  if (!deps) {
    deps = {
      keyboards: require('./keyboards'),
    };
  }
  return deps;
}

/** Wraps a handler so it only runs if ctx.state.role has the given permission. */
function guarded(permission, handler) {
  return async (ctx) => {
    if (!can(ctx.state.role, permission)) {
      await ctx.reply("🚫 You don't have access to that. Ask the shop owner if you should.");
      return;
    }
    return handler(ctx);
  };
}

/** [text, handler(ctx)] pairs, in the order buttons are checked. */
function getMainMenuActions() {
  const { keyboards } = requireDeps();
  return [
    ['📦 Inventory', guarded('inventory', (ctx) => ctx.reply('📦 *Inventory* — what would you like to do?', keyboards.inventoryMenu))],
    ['⬅️ Back to Menu', (ctx) => ctx.reply('🏠 *Main menu*', keyboards.mainMenuFor(ctx.state.role))],
    ['➕ Add New Item', guarded('inventory', (ctx) => ctx.scene.enter('ADD_ITEM'))],
    ['🔁 Restock Existing', guarded('inventory', (ctx) => ctx.scene.enter('RESTOCK_ITEM'))],
    ['🛒 New Order', guarded('orders', (ctx) => ctx.scene.enter('NEW_ORDER'))],
    ['🚚 Log Delivery', guarded('deliveries', (ctx) => ctx.scene.enter('LOG_DELIVERY'))],
    ['📣 Marketing', guarded('marketing', (ctx) => ctx.scene.enter('LOG_MARKETING'))],
    ['📊 Dashboard', guarded('dashboard', (ctx) => ctx.scene.enter('DASHBOARD'))],
    ['📝 Feedback', guarded('feedback', (ctx) => ctx.scene.enter('SEND_FEEDBACK'))],
    ['👤 Add User', guarded('users', (ctx) => ctx.scene.enter('ADD_USER'))],
  ];
}

module.exports = { getMainMenuActions };
