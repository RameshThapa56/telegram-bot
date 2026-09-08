// Marketing spend log — a flat log entry, not campaign attribution. Three
// required taps/inputs (platform, post date, amount), three skippable ones
// (reach, engagement, notes). No linkage to Orders/ItemID anywhere here.

const { Scenes } = require('telegraf');
const marketingRepo = require('../repos/marketingRepo');
const keyboards = require('../keyboards');
const { step, textInput, leaveToMenu } = require('./common');
const { parseNumber, money, escapeMd } = require('../utils/format');

const PLATFORM_BY_LABEL = {
  '📸 Instagram': 'Instagram',
  '📘 Facebook': 'Facebook',
  '🎵 TikTok': 'TikTok',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

const marketingWizard = new Scenes.WizardScene(
  'LOG_MARKETING',
  step(async (ctx) => {
    ctx.wizard.state.marketing = {};
    await ctx.reply('📣 *Log Marketing Spend*\n─────────────────\nWhich platform?', keyboards.platformKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const platform = PLATFORM_BY_LABEL[textInput(ctx)];
    if (!platform) return ctx.reply('Please pick a platform using the buttons.');

    ctx.wizard.state.marketing.platform = platform;
    await ctx.reply('📅 Post date? Tap *Today*, or type a date (e.g. 04-09-2026).', keyboards.postDateKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (!text) return ctx.reply('Please enter a date, or tap Today.');

    ctx.wizard.state.marketing.postDate = text === '📅 Today' ? todayIso() : text;
    await ctx.reply('💵 Amount spent, in Nu.?', keyboards.cancelKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const amount = parseNumber(textInput(ctx));
    if (amount === null || amount < 0) return ctx.reply('Please enter a valid number.');

    ctx.wizard.state.marketing.amountSpend = amount;
    await ctx.reply('👀 Reach? _(optional — tap Skip if you don\'t have it)_', keyboards.skipKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text === '⏭️ Skip') {
      ctx.wizard.state.marketing.reach = '';
    } else {
      const reach = parseNumber(text);
      if (reach === null || reach < 0) return ctx.reply('Please enter a valid number, or tap Skip.');
      ctx.wizard.state.marketing.reach = reach;
    }
    await ctx.reply('💬 Engagement? _(likes/comments/shares — optional)_', keyboards.skipKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text === '⏭️ Skip') {
      ctx.wizard.state.marketing.engagement = '';
    } else {
      const engagement = parseNumber(text);
      if (engagement === null || engagement < 0) return ctx.reply('Please enter a valid number, or tap Skip.');
      ctx.wizard.state.marketing.engagement = engagement;
    }
    await ctx.reply('📝 Any notes? _(optional)_', keyboards.skipKeyboard);
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    ctx.wizard.state.marketing.notes = text === '⏭️ Skip' ? '' : text;

    const m = ctx.wizard.state.marketing;
    await ctx.reply(
      `📋 *Confirm marketing spend*\n─────────────────\n` +
        `Platform: *${m.platform}*\n` +
        `Post date: ${escapeMd(m.postDate)}\n` +
        `Amount: *${money(m.amountSpend)}*\n` +
        (m.reach !== '' ? `Reach: ${m.reach}\n` : '') +
        (m.engagement !== '' ? `Engagement: ${m.engagement}\n` : '') +
        (m.notes ? `Notes: ${escapeMd(m.notes)}\n` : '') +
        `─────────────────\nSave this entry?`,
      keyboards.yesNoKeyboard
    );
    return ctx.wizard.next();
  }),
  step(async (ctx) => {
    const text = textInput(ctx);
    if (text !== '✅ Yes') return leaveToMenu(ctx, '🚫 Not saved. Back to the main menu.');

    const m = ctx.wizard.state.marketing;
    const campaignId = await marketingRepo.addMarketingRecord({
      platform: m.platform,
      postDate: m.postDate,
      amountSpend: m.amountSpend,
      reach: m.reach,
      engagement: m.engagement,
      notes: m.notes,
      createdBy: ctx.from.username || ctx.from.first_name || String(ctx.from.id),
    });

    await ctx.reply(`✅ *Marketing spend \`${campaignId}\` logged.*`, keyboards.mainMenuFor(ctx.state.role));
    return ctx.scene.leave();
  })
);

module.exports = { marketingWizard };
