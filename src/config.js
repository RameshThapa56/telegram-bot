// Central place that reads process.env and fails loudly (at boot) if something
// required is missing — better to crash on startup than fail silently mid-order.
// Never hardcode secrets here; everything comes from environment variables,
// which are set in `.env` locally (git-ignored) and in the host's dashboard in prod.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseAdminIds(raw) {
  return String(raw)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number);
}

const config = {
  botToken: required('BOT_TOKEN'),
  adminChatIds: parseAdminIds(required('ADMIN_CHAT_IDS')),

  sheetId: required('GOOGLE_SHEET_ID'),
  // OAuth2 client identity (from Google Cloud Console → Credentials → OAuth client ID,
  // type "Desktop app"). The refresh token is produced once by
  // `scripts/authorizeGoogle.js` and then reused forever — see README §3.
  googleOAuthClientId: required('GOOGLE_OAUTH_CLIENT_ID'),
  googleOAuthClientSecret: required('GOOGLE_OAUTH_CLIENT_SECRET'),
  googleOAuthRefreshToken: required('GOOGLE_OAUTH_REFRESH_TOKEN'),

  webhookSecretPath: process.env.WEBHOOK_SECRET_PATH || '',
  publicUrl: process.env.PUBLIC_URL || '',

  countryCallingCode: process.env.COUNTRY_CALLING_CODE || '975',
  businessName: process.env.BUSINESS_NAME || 'SoleMate Kick',

  // ---- Post-delivery feedback form (see utils/feedback.js) ----
  // Set automatically by `npm run setup-feedback-form` (scripts/setupFeedbackForm.js),
  // which creates the Google Form itself. Left optional here (not
  // `required()`) so the bot keeps running before that's been run —
  // buildFeedbackFormLink() throws a clear error at call time instead, only
  // when "Mark Delivered" is actually used.
  feedbackFormBaseUrl: process.env.FEEDBACK_FORM_BASE_URL || '',
  feedbackFormOrderIdEntry: process.env.FEEDBACK_FORM_ORDER_ID_ENTRY || '',
};

module.exports = config;
