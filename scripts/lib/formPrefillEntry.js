// Finds the real "entry.<id>" pre-fill parameter for a form question.
//
// Why this exists: the Forms REST API's `question.questionId` (from
// forms.get()) is NOT reliably the same number Google uses for pre-fill
// links — confirmed by creating a form and comparing: the API reported one
// ID, but the live form page's own embedded data used a different one, and
// only that second one actually pre-filled the field. questionId is scoped
// to matching *submitted responses*, not building pre-fill URLs; Google
// doesn't expose the pre-fill ID through any documented API. The only place
// it actually appears is baked into the public responder page itself (the
// same data "Get pre-filled link" reads client-side), so this fetches that
// page and reads it directly — the same trick most third-party Forms
// pre-fill tools use, since there's no supported alternative.
//
// If Google changes this page's internal structure, this throws a clear
// error rather than silently returning a wrong ID.

const https = require('https');
const vm = require('vm');

function fetchHtml(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          fetchHtml(res.headers.location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Fetching form page failed: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

/** Extracts and evaluates the `FB_PUBLIC_LOAD_DATA_ = [...]` array embedded in a form's responder page HTML. */
function parseLoadData(html) {
  const marker = 'FB_PUBLIC_LOAD_DATA_ = ';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find form data on the page — Google may have changed their form page markup.');
  }

  // Bracket-match from the opening "[" to its balanced closing "]" (safer
  // than a regex given the array contains nested arrays/brackets).
  const arrayStart = markerIndex + marker.length;
  let depth = 0;
  let end = -1;
  for (let i = arrayStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error('Could not parse form data on the page (unbalanced brackets).');

  const arrayLiteral = html.slice(arrayStart, end);
  // Evaluated in an isolated, no-global-access sandbox — this is Google's
  // own JS array literal (numbers/strings/null/nested arrays only), not
  // arbitrary script, but it's still page content, so don't run it in the
  // main context.
  return vm.runInNewContext(`(${arrayLiteral})`, {}, { timeout: 2000 });
}

/**
 * Fetches a form's responder page and returns the "entry.<id>" pre-fill
 * parameter for the first question whose title starts with `titlePrefix`.
 */
async function getPrefillEntryId(responderUri, titlePrefix) {
  const html = await fetchHtml(responderUri);
  const loadData = parseLoadData(html);

  const items = loadData && loadData[1] && loadData[1][1];
  if (!Array.isArray(items)) {
    throw new Error('Unexpected form data shape on the page — Google may have changed their form page format.');
  }

  const item = items.find((it) => typeof it[1] === 'string' && it[1].startsWith(titlePrefix));
  if (!item) throw new Error(`Could not find a question titled "${titlePrefix}..." on the form.`);

  const entryId = item[4] && item[4][0] && item[4][0][0];
  if (!entryId) throw new Error(`Found the "${titlePrefix}" question but couldn't read its entry ID.`);

  return `entry.${entryId}`;
}

module.exports = { getPrefillEntryId };
