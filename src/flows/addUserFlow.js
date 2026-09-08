// Owner-only: grants bot access to a new Telegram ID by writing a row to
// the "Users" sheet. Equivalent to typing the row into the sheet directly —
// this just saves the owner a trip to Google Sheets for the common case.
// Entry into this scene is already gated by the "users" permission (see
// mainMenuActions.js), but the first step re-checks in case this is ever
// reached another way.

const { Scenes } = require('telegraf');
const usersRepo = require('../repos/usersRepo');
const keyboards = require('../keyboards');
const { ROLES, can } = require('../permissions');
const { step, textInput, leaveToMenu } = require('./common');
const { escapeMd } = require('../utils/format');

const addUserWizard = new Scenes.WizardScene(
  'ADD_USER',
  step(async (ctx) => {
    if (!can(ctx.state.role, 'users')) {
      await leaveToMenu(ctx, "🚫 You don't have access to that.");
      return;
    }
    ctx.wizard.state.newUser = {};
    await ctx.reply(
      '👤 *Add User*\n─────────────────\n' +
        "What's their Telegram numeric ID? _(ask them to message @userinfobot, or use the ID from their own \"access denied\" message)_",
      keyboards.cancelKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    const telegramId = text && /^-?\d+$/.test(text) ? text : null;
    if (!telegramId) return ctx.reply('Please enter a numeric Telegram ID (digits only).');

    ctx.wizard.state.newUser.telegramId = telegramId;
    await ctx.reply('🙋 Their name? _(for your own reference in the sheet)_', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const name = textInput(ctx);
    if (!name) return ctx.reply('Please type a name.');

    ctx.wizard.state.newUser.name = name;
    await ctx.reply(
      '🎭 Which role?\n' +
        `*${ROLES.OWNER}* — full access\n` +
        `*${ROLES.STAFF}* — Inventory, Orders, Deliveries, Dashboard\n` +
        `*${ROLES.MARKETING}* — Marketing, Dashboard`,
      keyboards.roleKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    const role = Object.values(ROLES).find((r) => text === r);
    if (!role) return ctx.reply('Please pick a role using the buttons.');

    ctx.wizard.state.newUser.role = role;
    const u = ctx.wizard.state.newUser;
    await ctx.reply(
      `📋 *Confirm new user*\n─────────────────\n` +
        `Telegram ID: \`${u.telegramId}\`\nName: ${escapeMd(u.name)}\nRole: *${u.role}*\n─────────────────\n` +
        `Save this user?`,
      keyboards.yesNoKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text !== '✅ Yes') return leaveToMenu(ctx, '🚫 Not saved. Back to the main menu.');

    const u = ctx.wizard.state.newUser;
    await usersRepo.addUser({
      telegramId: u.telegramId,
      name: u.name,
      role: u.role,
      addedBy: ctx.from.username || ctx.from.first_name || String(ctx.from.id),
    });

    await ctx.reply(
      `✅ *${escapeMd(u.name)}* added as *${u.role}*.\n` +
        `They can message the bot now — no restart or redeploy needed.`,
      keyboards.mainMenuFor(ctx.state.role)
    );
    return ctx.scene.leave();
  })
);

module.exports = { addUserWizard };
