// Vercel serverless function — this is the ONLY thing that runs in production.
// There is no `app.listen()`, no always-on process: Vercel spins up this
// function on demand each time Telegram calls the webhook URL, and tears it
// down when idle. That's what satisfies "no dedicated always-on server" —
// combined with sessions persisted in Sheets (not memory), a cold start
// between messages is invisible to the user.
//
// The URL itself doubles as a secret: Telegram calls
//   https://your-app.vercel.app/api/webhook/<WEBHOOK_SECRET_PATH>
// and we reject anything that doesn't match, so a stranger who finds your
// Vercel URL can't feed fake updates into the bot.

const bot = require('../src/bot');
const config = require('../src/config');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('SoleMate Kick bot webhook is alive.');
    return;
  }

  const requestSecret = req.query && req.query.secret;
  if (!config.webhookSecretPath || requestSecret !== config.webhookSecretPath) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error('Webhook handling error:', err);
  }
  // Telegraf writes the response itself when needed; make sure something is sent.
  if (!res.writableEnded) res.status(200).send('OK');
};
