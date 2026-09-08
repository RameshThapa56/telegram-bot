const { Scenes } = require('telegraf');
const keyboards = require('../keyboards');
const { step, callbackValue, leaveToMenu } = require('./common');
const { sendDashboard } = require('../dashboard');

const dashboardWizard = new Scenes.WizardScene(
  'DASHBOARD',
  step(async (ctx) => {
    await ctx.reply('📊 *Dashboard*\n─────────────────\nWhich period?', keyboards.periodInlineKeyboard());
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const cb = await callbackValue(ctx, 'dperiod');
    if (!cb) return;
    if (cb.cancelled) return leaveToMenu(ctx);

    await sendDashboard(ctx, cb.value);
    return ctx.scene.leave();
  })
);

module.exports = { dashboardWizard };
