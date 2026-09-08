// Reads/writes the "Users" sheet tab — the bot's staff directory. Each row
// is {TelegramID, Name, Role, AddedAt, AddedBy}. This is what authGuard
// (src/middleware/auth.js) checks on every message, so it's cached briefly:
// the auth check runs on *every* update, and this repo is the only thing
// standing between "read the Users tab" and "read it once for the whole
// process, refreshed periodically (and instantly on addUser)".

const sheets = require('../google/sheetsClient');

const SHEET = 'Users';
const CACHE_TTL_MS = 30 * 1000;

let cache = null; // { rows, expiresAt }

async function listAll() {
  if (cache && cache.expiresAt > Date.now()) return cache.rows;
  const rows = await sheets.getRowsAsObjects(SHEET);
  cache = { rows, expiresAt: Date.now() + CACHE_TTL_MS };
  return rows;
}

async function findByTelegramId(telegramId) {
  const rows = await listAll();
  return rows.find((r) => String(r.TelegramID) === String(telegramId));
}

async function addUser({ telegramId, name, role, addedBy }) {
  await sheets.appendRow(SHEET, {
    TelegramID: String(telegramId),
    Name: name,
    Role: role,
    AddedAt: new Date().toISOString(),
    AddedBy: addedBy,
  });
  cache = null; // bust the cache so the new user can message the bot immediately
}

module.exports = { listAll, findByTelegramId, addUser };
