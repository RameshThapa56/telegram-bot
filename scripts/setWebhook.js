// One-off script to point Telegram at your deployed webhook (or remove it).
// Run after every deploy where PUBLIC_URL changes: npm run set-webhook
// Run `npm run delete-webhook` to switch back to local long-polling testing
// (Telegram only allows ONE active method — webhook OR polling — at a time).

require('dotenv').config();
const { Telegraf } = require('telegraf');
const config = require('../src/config');

const bot = new Telegraf(config.botToken);
const shouldDelete = process.argv.includes('--delete');

(async () => {
  if (shouldDelete) {
    await bot.telegram.deleteWebhook();
    console.log('✅ Webhook removed. You can now use `npm run dev` for local polling.');
    return;
  }

  if (!config.publicUrl || !config.webhookSecretPath) {
    throw new Error('Set PUBLIC_URL and WEBHOOK_SECRET_PATH in your .env before running this.');
  }

  const url = `${config.publicUrl}/api/webhook?secret=${config.webhookSecretPath}`;
  await bot.telegram.setWebhook(url);
  console.log(`✅ Webhook set to: ${url}`);

  const info = await bot.telegram.getWebhookInfo();
  console.log(info);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
