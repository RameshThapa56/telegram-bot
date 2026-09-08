// Local development entry point. Uses long-polling (bot repeatedly asks
// Telegram "any new messages?") instead of a webhook — no public URL needed,
// perfect for testing on your laptop. Run with: npm run dev
// (Never used in production — Vercel uses api/webhook.js instead.)

require('dotenv').config();
const bot = require('../src/bot');

bot.launch().then(() => {
  console.log('🤖 SoleMate Kick bot running locally (long-polling). Press Ctrl+C to stop.');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
