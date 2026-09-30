// Entry point for both `npm run dev` (APP_ENV=dev) and `npm start` (prod).
// Uses long-polling (bot repeatedly asks Telegram "any new messages?"),
// so no public URL or webhook is needed.
//
// When PORT is set (Render sets it automatically) it also serves GET /health.
// Render's free web services sleep after 15 minutes without inbound HTTP
// traffic, so point a free pinger (e.g. UptimeRobot) at /health every ~5 min.

require('./lib/loadEnv');
const http = require('http');
const bot = require('../src/bot');

if (process.env.PORT) {
  http
    .createServer((req, res) => {
      const ok = req.url === '/health' || req.url === '/';
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'text/plain' });
      res.end(ok ? 'ok' : 'not found');
    })
    .listen(process.env.PORT, () => console.log(`Health endpoint listening on :${process.env.PORT}/health`));
}

bot.launch().catch((err) => {
  console.error('Bot failed to launch:', err);
  process.exit(1);
});
console.log('🤖 SoleMate Kick bot starting (long-polling). Press Ctrl+C to stop.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
