// One-time script: creates the post-delivery feedback Google Form itself
// (Order ID, Rating, Comments) via the Forms API, instead of you building it
// by hand in the Forms UI, then writes the two env vars the bot needs
// (FEEDBACK_FORM_BASE_URL, FEEDBACK_FORM_ORDER_ID_ENTRY) straight into .env —
// same "script does the Google setup + saves the result to .env" pattern as
// scripts/authorizeGoogle.js. Run with: npm run setup-feedback-form
//
// Requires the `forms.body` OAuth scope. If your GOOGLE_OAUTH_REFRESH_TOKEN
// was issued before this scope existed, run `npm run authorize-google` again
// first (it now requests both scopes) to get a token that covers Forms too.
//
// What this does NOT automate: linking the form's responses to a Sheet. The
// Forms API has no endpoint for that — it's a single manual click that stays
// entirely inside Google's UI (open the form → Responses tab → green Sheets
// icon → "Select existing spreadsheet" → pick the SAME spreadsheet the bot
// already uses (GOOGLE_SHEET_ID), so responses land as a new "Feedback" tab
// alongside Inventory/Orders/Deliveries/Marketing/Users, instead of a
// separate file). That one click is what makes "responses auto-write to a
// Sheet" need zero custom backend code, so it's a feature, not a gap — this
// script prints the exact next step (with the right spreadsheet link) at
// the end.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');
const config = require('../src/config');
const { getPrefillEntryId } = require('./lib/formPrefillEntry');

const ENV_PATH = path.join(__dirname, '..', '.env');

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

(async () => {
  // Re-running this always creates a brand-new form (the Forms API has no
  // "update in place" for the base URL) — guard against accidentally
  // orphaning the form already wired up in .env.
  if (config.feedbackFormBaseUrl) {
    const answer = await confirm(
      `FEEDBACK_FORM_BASE_URL is already set in .env (${config.feedbackFormBaseUrl}).\n` +
        'Running this again creates a SEPARATE new form and overwrites that value. Continue? (y/N) '
    );
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Cancelled — .env left unchanged.');
      process.exit(0);
    }
  }

  const auth = new google.auth.OAuth2(config.googleOAuthClientId, config.googleOAuthClientSecret);
  auth.setCredentials({ refresh_token: config.googleOAuthRefreshToken });
  const forms = google.forms({ version: 'v1', auth });

  // 1. Create the form shell — Forms API only accepts a title at creation
  //    time; description + questions are added via a follow-up batchUpdate.
  const { data: created } = await forms.forms.create({
    requestBody: {
      info: {
        title: `${config.businessName} — Delivery Feedback`,
        documentTitle: `${config.businessName} — Delivery Feedback (responses)`,
      },
    },
  });
  const formId = created.formId;
  console.log(`Created form: ${formId}`);

  // 2. Add the description + the three questions in the order the customer
  //    sees them. Order ID is a plain short-answer question pre-filled by
  //    the wa.me link (see utils/feedback.js) — Google Forms has no native
  //    "hidden field" concept, so a customer *could* still edit it. Two
  //    things make that a non-issue in practice: (a) they only ever reach
  //    this form via the link staff send them, which already has their own
  //    Order ID baked in — there's nothing for them to look up or type, and
  //    (b) the title/description here spell out "already filled in, leave
  //    it" so there's no reason for them to touch it.
  await forms.forms.batchUpdate({
    formId,
    requestBody: {
      requests: [
        {
          updateFormInfo: {
            info: {
              description: `Thanks for shopping with ${config.businessName}! We'd love a minute of your feedback.`,
            },
            updateMask: 'description',
          },
        },
        {
          createItem: {
            item: {
              title: 'Order ID (already filled in — please leave as is)',
              description: "This came from the link you tapped, so there's nothing to type here.",
              questionItem: {
                question: { required: true, textQuestion: { paragraph: false } },
              },
            },
            location: { index: 0 },
          },
        },
        {
          createItem: {
            item: {
              title: 'How would you rate your experience?',
              questionItem: {
                question: {
                  required: true,
                  scaleQuestion: { low: 1, high: 5, lowLabel: 'Poor', highLabel: 'Excellent' },
                },
              },
            },
            location: { index: 1 },
          },
        },
        {
          createItem: {
            item: {
              title: 'Any comments? (optional)',
              questionItem: {
                question: { required: false, textQuestion: { paragraph: true } },
              },
            },
            location: { index: 2 },
          },
        },
      ],
    },
  });

  const { data: full } = await forms.forms.get({ formId });
  const responderUri = full.responderUri;

  // 3. Find the real "entry.<id>" pre-fill parameter. NOTE: this is
  //    deliberately NOT full.items[...].questionItem.question.questionId —
  //    that ID is for matching *submitted responses*, and testing showed it
  //    is a DIFFERENT number from the one Google actually reads off a
  //    pre-fill link. getPrefillEntryId() reads the real one straight off
  //    the published page instead — see lib/formPrefillEntry.js for why.
  const orderIdEntry = await getPrefillEntryId(responderUri, 'Order ID');

  console.log(`\nForm URL (share/edit):  https://docs.google.com/forms/d/${formId}/edit`);
  console.log(`Form URL (respond):     ${responderUri}`);
  console.log(`Order ID entry field:   ${orderIdEntry}`);

  setEnvVar('FEEDBACK_FORM_BASE_URL', responderUri);
  setEnvVar('FEEDBACK_FORM_ORDER_ID_ENTRY', orderIdEntry);
  console.log(`\n✅ Saved FEEDBACK_FORM_BASE_URL and FEEDBACK_FORM_ORDER_ID_ENTRY to ${ENV_PATH}`);

  console.log(
    '\n👉 Last manual step (native Google Forms feature, one click) — link responses into your\n' +
      '   existing bot Sheet as their own "Feedback" tab, same as Inventory/Orders/Marketing/Users:\n' +
      `     1. Open https://docs.google.com/forms/d/${formId}/edit → *Responses* tab.\n` +
      '     2. Click the green Sheets icon → "Select existing spreadsheet" → choose:\n' +
      `        ${config.businessName} sheet — https://docs.google.com/spreadsheets/d/${config.sheetId}/edit\n` +
      '     3. Google adds a new tab (named after the form) with every response written there\n' +
      '        automatically from then on — no bot code involved. Optionally rename that tab to\n' +
      '        "Feedback" to match the others.\n' +
      '   Then redeploy (or restart) the bot so it picks up the new .env values.'
  );
})().catch((err) => {
  console.error('\n❌ Failed to create feedback form:', err.message);
  if (/insufficient permission/i.test(err.message)) {
    console.error(
      '\nThis almost always means one of:\n' +
        '  1. The Google Forms API isn\'t enabled yet — Google Cloud Console →\n' +
        '     APIs & Services → Library → search "Google Forms API" → Enable.\n' +
        '  2. GOOGLE_OAUTH_REFRESH_TOKEN in .env was issued before the forms.body\n' +
        '     scope was added — run `npm run authorize-google` again to get a token\n' +
        '     that covers Forms, then re-run this script.'
    );
  }
  process.exit(1);
});

function setEnvVar(name, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  content = pattern.test(content) ? content.replace(pattern, line) : `${content}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, content);
}
