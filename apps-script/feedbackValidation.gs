// Google Forms has no "read-only" or locked field — a customer can always
// edit the pre-filled Order ID before submitting, however clearly it's
// labeled "please leave as is" (see utils/feedback.js / setupFeedbackForm.js
// on the Node side). This script can't prevent that edit, but it can catch
// it: every time a new Feedback response comes in, it checks the submitted
// Order ID against the Orders tab and writes ✅/❌ into a "Valid?" column on
// that same row, so staff can spot a tampered/mistyped one at a glance
// instead of quietly trusting it.
//
// ---- One-time install ----
// 1. Open the bot's Google Sheet → Extensions → Apps Script.
// 2. Paste this whole file in (replace the default Code.gs content, or add
//    it as a new file — either works).
// 3. Save (💾), then in the function dropdown at the top pick
//    "setupFeedbackValidationTrigger" and click ▶ Run.
// 4. Google will prompt for authorization the first time — approve it (this
//    script only reads/writes the sheets in this same spreadsheet).
// 5. Done — every new Feedback response is checked automatically from now
//    on. To also check responses that arrived before you installed this,
//    run "revalidateAllFeedbackResponses" once the same way.

var FEEDBACK_SHEET_NAME = 'Feedback';
var ORDERS_SHEET_NAME = 'Orders';
var ORDER_ID_COLUMN_PREFIX = 'Order ID'; // matches the Feedback tab's question-title header
var VALID_COLUMN_HEADER = 'Valid?';
var ORDERS_ORDER_ID_HEADER = 'OrderID'; // matches ordersRepo.js's Sheets header, not the Forms one above

/** Run once from the Apps Script editor to install the trigger. Safe to re-run — it replaces any previous copy of the trigger instead of duplicating it. */
function setupFeedbackValidationTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === 'onFeedbackFormSubmit';
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });

  ScriptApp.newTrigger('onFeedbackFormSubmit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onFormSubmit().create();

  Logger.log('Installed — new Feedback responses will be validated automatically from now on.');
}

/** Fires automatically on every new Feedback form submission (installed by setupFeedbackValidationTrigger, above). */
function onFeedbackFormSubmit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FEEDBACK_SHEET_NAME) return; // ignore submissions to any other linked form, if ever added
  validateRow(sheet, e.range.getRow());
}

/**
 * One-off backfill: checks every existing Feedback response (e.g. ones that
 * arrived before this script was installed). Run manually from the Apps
 * Script editor whenever you want to (re)check the whole tab.
 */
function revalidateAllFeedbackResponses() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET_NAME);
  if (!sheet) throw new Error('No "' + FEEDBACK_SHEET_NAME + '" tab found.');
  var lastRow = sheet.getLastRow();
  for (var row = 2; row <= lastRow; row++) {
    validateRow(sheet, row);
  }
  Logger.log('Checked ' + (lastRow - 1) + ' response(s).');
}

function validateRow(sheet, row) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var orderIdCol = findColumnByPrefix(headerRow, ORDER_ID_COLUMN_PREFIX);
  if (!orderIdCol) return; // Forms hasn't written its header yet, or was renamed — nothing to check against

  var validCol = headerRow.indexOf(VALID_COLUMN_HEADER) + 1;
  if (!validCol) {
    validCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, validCol).setValue(VALID_COLUMN_HEADER);
  }

  var submittedOrderId = String(sheet.getRange(row, orderIdCol).getValue()).trim();
  var ok = orderExists(submittedOrderId);
  sheet.getRange(row, validCol).setValue(ok ? '✅' : '❌ Order ID not found — check for a typo or edited field');
}

function findColumnByPrefix(headerRow, prefix) {
  for (var i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i]).indexOf(prefix) === 0) return i + 1; // 1-indexed for Range
  }
  return 0;
}

/** True if `orderId` appears anywhere in the Orders tab (multi-item orders repeat an OrderID across several rows — any match is enough). */
function orderExists(orderId) {
  if (!orderId) return false;
  var ordersSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDERS_SHEET_NAME);
  if (!ordersSheet) return false;

  var data = ordersSheet.getDataRange().getValues();
  var header = data[0];
  var orderIdCol = header.indexOf(ORDERS_ORDER_ID_HEADER);
  if (orderIdCol === -1) return false;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][orderIdCol]).trim() === orderId) return true;
  }
  return false;
}
