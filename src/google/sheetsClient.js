// Low-level Google Sheets access. Nothing in here knows about "orders" or
// "inventory" — that domain knowledge lives in src/repos/*. This file only
// knows how to talk to the Sheets API: read rows, append rows, update a range.
//
// Auth: OAuth2 acting as YOUR Google account, not a service account.
// (Service account key files are the normal recommendation here, but many
// Google Cloud projects now have key-file creation blocked by an
// organization security policy — see README §3. OAuth sidesteps that: you
// run a one-time authorization in a browser once, `scripts/authorizeGoogle.js`
// saves the resulting refresh token, and the bot uses that refresh token to
// silently get new access tokens forever after — no browser step ever again,
// and the Sheet doesn't need to be "shared" with anything since it's already
// yours.)

const { google } = require('googleapis');
const config = require('../config');

let sheetsApiPromise = null;

function getSheetsApi() {
  if (!sheetsApiPromise) {
    const auth = new google.auth.OAuth2(config.googleOAuthClientId, config.googleOAuthClientSecret);
    auth.setCredentials({ refresh_token: config.googleOAuthRefreshToken });
    sheetsApiPromise = Promise.resolve(google.sheets({ version: 'v4', auth }));
  }
  return sheetsApiPromise;
}

/**
 * Reads every row of a sheet tab and returns them as plain objects keyed by
 * the header row (row 1). e.g. [{ ItemID: 'INV-001', Brand: 'Nike', ... }, ...]
 * Also attaches a hidden `_rowNumber` (1-indexed, matching the actual sheet
 * row) so callers can update/delete the exact row later without re-searching.
 */
async function getRowsAsObjects(sheetName) {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A:Z`,
    // Without this, currency-formatted columns (see setupSheet.js) come back
    // as display strings like "Nu. 1,200.00" instead of numbers, which then
    // fail Number(...) parsing (NaN) everywhere those values are summed.
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows.map((row, idx) => {
    const obj = { _rowNumber: idx + 2 }; // +2: skip header, and sheet rows are 1-indexed
    header.forEach((col, colIdx) => {
      obj[col] = row[colIdx] !== undefined ? row[colIdx] : '';
    });
    return obj;
  });
}

/** Appends one row to the end of a sheet tab. `rowObject` keys must match the header row. */
async function appendRow(sheetName, rowObject) {
  const sheets = await getSheetsApi();
  const header = await getHeader(sheetName);
  const row = header.map((col) => (rowObject[col] !== undefined ? rowObject[col] : ''));

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/**
 * Appends several rows in one API call — used when one action produces
 * multiple sheet rows at once (e.g. a multi-item order), so it costs one
 * round trip instead of one per row. `rowObjects` keys must match the header.
 */
async function appendRows(sheetName, rowObjects) {
  const sheets = await getSheetsApi();
  const header = await getHeader(sheetName);
  const values = rowObjects.map((rowObject) => header.map((col) => (rowObject[col] !== undefined ? rowObject[col] : '')));

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}

/** Overwrites one existing row (by its 1-indexed sheet row number) with new values. */
async function updateRow(sheetName, rowNumber, rowObject) {
  const sheets = await getSheetsApi();
  const header = await getHeader(sheetName);
  const row = header.map((col) => (rowObject[col] !== undefined ? rowObject[col] : ''));

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

/** Updates a single cell, e.g. updateCell('Inventory', 5, 'Quantity', 12) */
async function updateCell(sheetName, rowNumber, columnName, value) {
  const sheets = await getSheetsApi();
  const header = await getHeader(sheetName);
  const colIdx = header.indexOf(columnName);
  if (colIdx === -1) throw new Error(`Column "${columnName}" not found in sheet "${sheetName}"`);
  const colLetter = columnIndexToLetter(colIdx);

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!${colLetter}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

/** Deletes a row's contents (keeps the row but blanks it) — used by the session store. */
async function clearRow(sheetName, rowNumber) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!A${rowNumber}:Z${rowNumber}`,
  });
}

const headerCache = new Map();
async function getHeader(sheetName) {
  if (headerCache.has(sheetName)) return headerCache.get(sheetName);
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${sheetName}!1:1`,
  });
  const header = (res.data.values && res.data.values[0]) || [];
  headerCache.set(sheetName, header);
  return header;
}

function columnIndexToLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

module.exports = {
  getRowsAsObjects,
  appendRow,
  appendRows,
  updateRow,
  updateCell,
  clearRow,
  getHeader,
};
