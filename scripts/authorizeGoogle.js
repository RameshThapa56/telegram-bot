// One-time script: authorizes the bot to act as YOUR Google account (not a
// service account — see README §3 for why) and saves the resulting refresh
// token into .env automatically. Run with: node scripts/authorizeGoogle.js
//
// What happens: this starts a tiny local web server, opens your browser to
// Google's consent screen, you log in and approve access to Sheets, Google
// redirects back to the local server with a one-time code, and this
// exchanges that code for a refresh token that lasts indefinitely (as long
// as the OAuth consent screen is set to "In production" — see README §3.4).
// You only ever do this once per Google account.

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const PORT = 53682; // arbitrary local port, only used during this one-time flow
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const ENV_PATH = path.join(__dirname, '..', '.env');

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first (from the OAuth client you created in Google Cloud Console — README §3).'
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // required to get a refresh_token, not just a short-lived access token
  prompt: 'consent', // forces Google to re-issue a refresh token even if you've authorized before
  scope: [
    'https://www.googleapis.com/auth/spreadsheets',
    // Only needed for scripts/setupFeedbackForm.js (auto-creates the
    // post-delivery feedback form). Harmless to include even if you never
    // run that script. If you authorized before this scope was added, rerun
    // this script once to pick it up — see setupFeedbackForm.js's header
    // comment.
    'https://www.googleapis.com/auth/forms.body',
  ],
});

console.log('\nOpen this URL in your browser and approve access:\n');
console.log(authUrl);
console.log(`\nWaiting for you to complete the sign-in... (listening on port ${PORT})\n`);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Authorization denied. You can close this tab.');
    console.error(`\n❌ Authorization was not granted (${errorParam}).`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('✅ Authorized! You can close this tab and return to the terminal.');

    if (!tokens.refresh_token) {
      console.error(
        '\n⚠️ No refresh token was returned. This usually means you already authorized this app before.\n' +
          'Go to https://myaccount.google.com/permissions, remove access for this app, and run this script again.'
      );
      server.close();
      process.exit(1);
    }

    saveRefreshTokenToEnv(tokens.refresh_token);
    console.log(`\n✅ Saved GOOGLE_OAUTH_REFRESH_TOKEN to ${ENV_PATH}`);
    console.log('You can now run: npm run setup-sheet');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Failed to exchange code for tokens:', err.message);
    res.writeHead(500).end('Something went wrong — check the terminal.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);

function saveRefreshTokenToEnv(refreshToken) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `GOOGLE_OAUTH_REFRESH_TOKEN=${refreshToken}`;

  if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(content)) {
    content = content.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, line);
  } else {
    content += `\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}
