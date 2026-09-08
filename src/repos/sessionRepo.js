// Persistent session storage backed by a "Sessions" tab in the same Google Sheet.
//
// Why this matters: serverless deployments (Vercel functions, Cloud Functions)
// do NOT keep a warm Node process around between messages — each webhook call
// can hit a fresh instance. An in-memory session (the default in every Telegraf
// tutorial) would silently forget which step of a wizard a staff member was on
// the moment their bot function goes cold — mid-order, that's a lost sale.
// Writing session state to the Sheet on every step means a restart, redeploy,
// or cold start never loses a user's place.
//
// This implements the {get, set, delete} interface Telegraf's session()
// middleware expects, so it plugs in as a drop-in store — see src/bot.js.

const sheets = require('../google/sheetsClient');

const SHEET = 'Sessions';

// Small in-memory cache so a *warm* instance (several messages in a row from
// the same staff member within the same process) skips the extra Sheets
// round trip. It's purely a speed optimization — correctness never depends
// on it, because every write still goes to the Sheet.
const cache = new Map();

async function findRow(chatId) {
  const rows = await sheets.getRowsAsObjects(SHEET);
  return rows.find((r) => r.ChatID === String(chatId));
}

async function get(chatId) {
  if (cache.has(chatId)) return cache.get(chatId);

  const row = await findRow(chatId);
  if (!row || !row.StateJSON) return undefined;

  try {
    const parsed = JSON.parse(row.StateJSON);
    cache.set(chatId, parsed);
    return parsed;
  } catch {
    return undefined; // corrupted/blank cell — treat as "no session"
  }
}

async function set(chatId, value) {
  cache.set(chatId, value);
  const stateJson = JSON.stringify(value);
  const existing = await findRow(chatId);

  if (existing) {
    await sheets.updateRow(SHEET, existing._rowNumber, {
      ChatID: String(chatId),
      StateJSON: stateJson,
      UpdatedAt: new Date().toISOString(),
    });
  } else {
    await sheets.appendRow(SHEET, {
      ChatID: String(chatId),
      StateJSON: stateJson,
      UpdatedAt: new Date().toISOString(),
    });
  }
}

async function del(chatId) {
  cache.delete(chatId);
  const existing = await findRow(chatId);
  if (existing) await sheets.clearRow(SHEET, existing._rowNumber);
}

module.exports = { get, set, delete: del };
