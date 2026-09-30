// Loads the env file for the chosen environment: APP_ENV=prod -> .env.prod,
// anything else (default) -> .env.dev. Falls back to a plain .env so older
// setups keep working. Exports ENV_PATH so scripts that write values back
// (authorizeGoogle, setupFeedbackForm) update the right file.
const fs = require('fs');
const path = require('path');

const APP_ENV = process.env.APP_ENV || 'dev';
const root = path.join(__dirname, '..', '..');
const named = path.join(root, `.env.${APP_ENV}`);
const ENV_PATH = fs.existsSync(named) || APP_ENV !== 'dev' ? named : path.join(root, '.env');

// On a host like Render there is no env file: variables come from the
// dashboard and are already in process.env, so just skip loading one.
if (!fs.existsSync(ENV_PATH) && process.env.BOT_TOKEN) {
  console.log(`[env] APP_ENV=${APP_ENV} -> using host environment variables`);
  module.exports = { APP_ENV, ENV_PATH };
  return;
}

if (!fs.existsSync(ENV_PATH)) {
  console.error(`Env file not found: ${ENV_PATH}\nCreate it from .env.example (APP_ENV=${APP_ENV}).`);
  process.exit(1);
}
require('dotenv').config({ path: ENV_PATH });
console.log(`[env] APP_ENV=${APP_ENV} -> ${path.basename(ENV_PATH)}`);

module.exports = { APP_ENV, ENV_PATH };
