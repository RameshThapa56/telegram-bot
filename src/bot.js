// The bot's composition root: builds one Telegraf instance with auth,
// persistent sessions, scenes, and the main-menu button handlers wired in.
// Both the local dev entry point (scripts/dev-polling.js) and the production
// webhook handler (api/webhook.js) import and reuse this same `bot` object —
// only how updates reach it differs (long-polling vs. a webhook call).

const { Telegraf, Scenes, session } = require('telegraf');
const config = require('./config');
const { authGuard } = require('./middleware/auth');
const keyboards = require('./keyboards');
const sessionRepo = require('./repos/sessionRepo');

const { addItemWizard, restockWizard } = require('./flows/inventoryFlow');
const { orderWizard } = require('./flows/orderFlow');
const { deliveryWizard } = require('./flows/deliveryFlow');
const { marketingWizard } = require('./flows/marketingFlow');
const { addUserWizard } = require('./flows/addUserFlow');
const { dashboardWizard } = require('./flows/dashboardFlow');
const { feedbackWizard } = require('./flows/feedbackFlow');
const { clearToMenu } = require('./flows/common');
const { getMainMenuActions } = require('./mainMenuActions');

const bot = new Telegraf(config.botToken);

// 0. Every reply renders Markdown (*bold*, `code`, dividers, …) by default,
//    so every flow file gets nicer formatting for free instead of having to
//    remember `{ parse_mode: 'Markdown' }` on every single ctx.reply call.
//    A call can still override/opt out by passing its own `extra`.
bot.use((ctx, next) => {
  const originalReply = ctx.reply.bind(ctx);
  ctx.reply = (text, extra) => originalReply(text, { parse_mode: 'Markdown', ...extra });
  return next();
});

// 1. Restrict the bot to staff only — everyone else is stopped here.
bot.use(authGuard());

// 2. Persistent session, backed by the "Sessions" tab (see src/repos/sessionRepo.js).
//    This is what makes a half-finished "New Order" survive a redeploy.
bot.use(session({ store: sessionRepo }));

// 3. Scene manager holding all multi-step flows.
const stage = new Scenes.Stage([
  addItemWizard,
  restockWizard,
  orderWizard,
  deliveryWizard,
  marketingWizard,
  addUserWizard,
  dashboardWizard,
  feedbackWizard,
]);
bot.use(stage.middleware());

// ---------- Top-level commands & main menu buttons ----------
// These only fire when no scene is active — Telegraf routes updates to the
// active scene's wizard step first if one is in progress, otherwise here.

bot.start((ctx) =>
  ctx.reply(
    `👟 *${config.businessName}*\n` +
      `─────────────────\n` +
      `Welcome, *${ctx.state.role}*! Use the buttons below — no typing needed for most steps.`,
    keyboards.mainMenuFor(ctx.state.role)
  )
);

// Sourced from mainMenuActions.js so these stay in sync with the same-named
// escape check every wizard step runs (see flows/common.js's tryMenuEscape).
for (const [text, handler] of getMainMenuActions()) {
  bot.hears(text, handler);
}

bot.command('cancel', (ctx) => ctx.reply('Nothing to cancel — use the menu buttons below.', keyboards.mainMenuFor(ctx.state.role)));
bot.hears('❌ Cancel', (ctx) => ctx.reply('🏠 *Main menu*', keyboards.mainMenuFor(ctx.state.role)));

// /clear (or plain "clear") always resets, even outside a scene — for a
// staff member who just wants a guaranteed clean slate (see flows/common.js).
bot.command('clear', clearToMenu);
bot.hears(/^clear$/i, clearToMenu);

// Fallback for anything unrecognized outside a flow — keeps non-technical
// staff from ever hitting a dead end with no idea what to press next.
bot.on('text', (ctx) => ctx.reply("🤔 I didn't understand that. Please use the buttons below.", keyboards.mainMenuFor(ctx.state.role)));

bot.catch((err, ctx) => {
  console.error(`Unhandled error for update ${ctx.update.update_id}:`, err);
});

module.exports = bot;
