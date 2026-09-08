// One-time setup script: creates the four tabs the bot needs (Inventory,
// Orders, Deliveries, Sessions) in your Google Sheet, with the correct
// header row in each, plus styling matching the Dashboard tab (see
// setupDashboard.js) — lavender header band, blush zebra rows, frozen
// header, currency formatting on money columns, and responsive cells (fixed
// column widths + text wrap + row auto-height, so long values like a
// DeliveryLocation or a Sessions StateJSON blob wrap inside the cell instead
// of overflowing or getting clipped). Safe to re-run — it skips creating
// tabs that already exist but always refreshes headers/styling.
// Run with: npm run setup-sheet

require('dotenv').config();
const { google } = require('googleapis');
const config = require('../src/config');

// Same palette as the Dashboard tab.
const LAVENDER = { red: 0.545, green: 0.576, blue: 0.718 };
const BLUSH = { red: 0.976, green: 0.925, blue: 0.91 };
const WHITE = { red: 1, green: 1, blue: 1 };
const INK = { red: 0.239, green: 0.251, blue: 0.325 }; // same body text color as the Dashboard tab

// Bhutanese banks offered in the bot's "Bank Transfer" order flow (see
// keyboards.js's bhutaneseBanks) — kept as a separate copy here (rather than
// requiring keyboards.js) so this one-off script doesn't pull in Telegraf.
// Keep the two lists in sync if you add/remove a bank.
const BHUTANESE_BANKS = ['Bank of Bhutan (BoB)', 'Bhutan National Bank (BNB)', 'Druk PNB Bank (DPNB)', 'T Bank (TBank)', 'BDBL', 'DK Bank'];

// Header row, money columns (0-based, for currency formatting), fixed pixel
// widths per column (0-based, same order as header) so cells wrap instead of
// endlessly stretching to fit their longest value, and dropdowns for columns
// whose values come from a fixed set in the bot — so editing a row by hand
// directly in Sheets gets the same dropdown instead of free-typed text that
// could drift from what the bot expects. `strict: false` still shows the
// dropdown but only warns (not blocks) on values outside the list, for
// columns the bot itself allows a custom value for (e.g. "Other (type it)").
const SHEETS = {
  Inventory: {
    header: ['ItemID', 'Brand', 'Name', 'Size', 'Color', 'Quantity', 'CostPrice', 'SellPrice', 'LastRestocked'],
    moneyCols: [6, 7],
    widths: [130, 100, 170, 70, 100, 90, 110, 110, 150],
  },
  Orders: {
    header: [
      'OrderID',
      'Timestamp',
      'ItemID',
      'ItemDesc',
      'Qty',
      'Price',
      'Total',
      'DeliveryLocation',
      'CustomerName',
      'CustomerPhone',
      'Status',
      'CreatedBy',
      'PaymentMethod',
      'BankName',
      'JournalNumber',
    ],
    moneyCols: [5, 6],
    widths: [150, 150, 130, 220, 60, 100, 100, 200, 150, 130, 130, 120, 140, 190, 150],
    dropdowns: [
      { col: 10, values: ['Pending', 'Out for Delivery', 'Delivered'], strict: true },
      { col: 12, values: ['Cash', 'Bank Transfer'], strict: true },
      { col: 13, values: BHUTANESE_BANKS, strict: false },
    ],
  },
  Deliveries: {
    header: ['DeliveryID', 'Timestamp', 'OrderID', 'Method', 'VehiclePlate', 'DriverPhone', 'DeliveryCharge', 'Status', 'CreatedBy'],
    moneyCols: [6],
    widths: [150, 150, 150, 100, 120, 130, 130, 130, 120],
    dropdowns: [
      { col: 3, values: ['Bus', 'Taxi'], strict: true },
      { col: 7, values: ['Out for Delivery', 'Delivered'], strict: true },
    ],
  },
  Sessions: {
    header: ['ChatID', 'StateJSON', 'UpdatedAt'],
    moneyCols: [],
    widths: [140, 380, 170],
  },
  Marketing: {
    header: ['CampaignID', 'Timestamp', 'Platform', 'PostDate', 'AmountSpend', 'Reach', 'Engagement', 'Notes', 'CreatedBy'],
    moneyCols: [4],
    widths: [150, 150, 110, 120, 120, 100, 110, 220, 120],
    dropdowns: [{ col: 2, values: ['Instagram', 'Facebook', 'TikTok'], strict: true }],
  },
  Users: {
    header: ['TelegramID', 'Name', 'Role', 'AddedAt', 'AddedBy'],
    moneyCols: [],
    widths: [140, 150, 110, 170, 120],
    dropdowns: [{ col: 2, values: ['Owner', 'Staff', 'Marketing'], strict: true }],
  },
  // Columns A-D populated by the linked Google Form (see
  // scripts/setupFeedbackForm.js), not the bot — those four MUST match what
  // Forms already wrote verbatim (Forms owns and keeps rewriting that part
  // of the row from the question titles) — don't reorder/reword them
  // without updating the form's question titles to match, or Forms will
  // just overwrite it back on the next response. Column E ("Valid?") is
  // ours: filled in by the Apps Script trigger in apps-script/feedbackValidation.gs,
  // which flags a response whose Order ID doesn't match a real order —
  // Google Forms has no way to make that field read-only, so this catches
  // a tampered/mistyped one instead of preventing it.
  Feedback: {
    header: [
      'Timestamp',
      'Order ID (already filled in — please leave as is)',
      'How would you rate your experience?',
      'Any comments? (optional)',
      'Valid?',
    ],
    moneyCols: [],
    widths: [170, 260, 220, 320, 260],
  },
};

// Left-to-right tab order to enforce on every run — decoupled from the
// SHEETS object's key order above (which only matters for the loops that
// build styling/header requests, not for display order). Feedback sits
// second-to-last, Users right before Sessions at the very end.
const TAB_ORDER = ['Inventory', 'Orders', 'Deliveries', 'Marketing', 'Feedback', 'Users', 'Sessions'];

const MIN_DATA_ROW_COUNT = 1000; // banding/formatting extends at least this far down so new rows inherit the look

(async () => {
  const auth = new google.auth.OAuth2(config.googleOAuthClientId, config.googleOAuthClientSecret);
  auth.setCredentials({ refresh_token: config.googleOAuthRefreshToken });
  const sheets = google.sheets({ version: 'v4', auth });

  let meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheetId });
  const existingTitles = meta.data.sheets.map((s) => s.properties.title);

  const tabsToCreate = Object.keys(SHEETS).filter((name) => !existingTitles.includes(name));
  if (tabsToCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: {
        requests: tabsToCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    console.log(`Created tabs: ${tabsToCreate.join(', ')}`);
    meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheetId }); // refetch so new tabs have sheetIds
  } else {
    console.log('All tabs already exist.');
  }

  const sheetByTitle = Object.fromEntries(meta.data.sheets.map((s) => [s.properties.title, s]));

  // Reorder tabs to match TAB_ORDER, left to right. Any tab this script
  // doesn't own (e.g. Dashboard, built by setupDashboard.js) is left where
  // it is and TAB_ORDER's tabs are placed after it, so re-running this
  // script never fights setupDashboard.js for the first tab slot.
  const nonOwnedCount = meta.data.sheets.length - TAB_ORDER.filter((name) => sheetByTitle[name]).length;
  const reorderRequests = TAB_ORDER.filter((name) => sheetByTitle[name]).map((name, i) => ({
    updateSheetProperties: {
      properties: { sheetId: sheetByTitle[name].properties.sheetId, index: nonOwnedCount + i },
      fields: 'index',
    },
  }));
  if (reorderRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: reorderRequests } });
    console.log(`Tab order set: ${TAB_ORDER.join(', ')}`);
  }

  for (const [name, { header }] of Object.entries(SHEETS)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `${name}!A1:${String.fromCharCode(64 + header.length)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] },
    });
    console.log(`Header set for ${name}`);
  }

  // Remove any banding this script previously created, so re-running doesn't pile up duplicates.
  const removeBandingRequests = [];
  for (const name of Object.keys(SHEETS)) {
    const s = sheetByTitle[name];
    for (const b of s.bandedRanges || []) {
      removeBandingRequests.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
    }
  }
  if (removeBandingRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: removeBandingRequests } });
  }

  const styleRequests = [];
  for (const [name, { header, moneyCols, widths, dropdowns }] of Object.entries(SHEETS)) {
    const sheetId = sheetByTitle[name].properties.sheetId;
    const colCount = header.length;
    // A tab with more data than MIN_DATA_ROW_COUNT (e.g. Marketing logging
    // more campaigns than another tab has orders) must still get styled all
    // the way down — otherwise rows past the fixed cutoff keep whatever
    // font/format they had when written, which is how a single tab quietly
    // ends up looking different from the rest (mismatched font size/color)
    // while every tab is styled by the exact same code.
    const dataRowCount = Math.max(MIN_DATA_ROW_COUNT, sheetByTitle[name].properties.gridProperties?.rowCount || 0);

    styleRequests.push(
      // Freeze header row, tint the tab to match the Dashboard
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 }, tabColor: LAVENDER },
          fields: 'gridProperties.frozenRowCount,tabColor',
        },
      },
      // Header row: lavender band, bold white text, centered — like the
      // dashboard-card reference (bold centered column titles on a solid band).
      {
        repeatCell: {
          range: gridRange(sheetId, 0, 1, 0, colCount),
          cell: {
            userEnteredFormat: {
              backgroundColor: LAVENDER,
              textFormat: { bold: true, foregroundColor: WHITE },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      },
      // Pin font, text color, AND weight (Poppins 11, INK gray, NOT bold)
      // across body rows. Poppins is the rounded, geometric sans used by the
      // reference — without pinning these, cells drift to whatever a cell
      // happened to have at the moment it was written (some tabs ended up
      // Arial, others Calibri; some rows bold from a copy-paste or an old
      // script version, others not), so tabs look inconsistent even though
      // every other style rule already matches — this is what was making
      // the Marketing tab's text look different (bold, in that case) from
      // the rest. `bold: false` is explicit here (not just omitted) because
      // omitting it would leave existing bold cells bold — the same
      // field-masked-but-still-drifts trap that caused this in the first
      // place. Field-masked so it layers on top of the header's bold/white
      // text instead of overwriting it (must run AFTER the header repeatCell
      // above, which replaces the whole textFormat).
      {
        repeatCell: {
          range: gridRange(sheetId, 1, dataRowCount, 0, colCount),
          cell: { userEnteredFormat: { textFormat: { fontFamily: 'Poppins', fontSize: 11, foregroundColor: INK, bold: false } } },
          fields:
            'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold',
        },
      },
      // Header row keeps the same font/size pinned too, just without touching its white color.
      {
        repeatCell: {
          range: gridRange(sheetId, 0, 1, 0, colCount),
          cell: { userEnteredFormat: { textFormat: { fontFamily: 'Poppins', fontSize: 11 } } },
          fields: 'userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize',
        },
      },
      // Blush zebra striping across the data rows
      {
        addBanding: {
          bandedRange: {
            range: gridRange(sheetId, 0, dataRowCount, 0, colCount),
            rowProperties: {
              headerColor: LAVENDER,
              firstBandColor: WHITE,
              secondBandColor: BLUSH,
            },
          },
        },
      },
      // Fixed column widths — deliberately generous but bounded, so a long
      // value wraps inside the cell instead of stretching the column forever.
      ...widths.map((pixelSize, i) => ({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize },
          fields: 'pixelSize',
        },
      })),
      // Responsive cells: wrap text instead of clipping/overflowing, centered
      // both ways — matches the reference's centered Due Date/Status/Type
      // columns instead of the default left-align-text/right-align-numbers mix.
      {
        repeatCell: {
          range: gridRange(sheetId, 0, dataRowCount, 0, colCount),
          cell: {
            userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE', horizontalAlignment: 'CENTER' },
          },
          fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment',
        },
      },
      // ...and grow row height to fit whatever wrapped
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: dataRowCount },
        },
      }
    );

    for (const col of moneyCols) {
      styleRequests.push({
        repeatCell: {
          range: gridRange(sheetId, 1, dataRowCount, col, col + 1),
          cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      });
    }

    for (const { col, values, strict } of dropdowns || []) {
      styleRequests.push({
        setDataValidation: {
          range: gridRange(sheetId, 1, dataRowCount, col, col + 1),
          rule: {
            condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
            strict,
            showCustomUi: true,
          },
        },
      });
    }
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: styleRequests } });
  console.log('Styling applied.');

  console.log('✅ Sheet setup complete.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Builds a GridRange. Row/column indexes are 0-based, end-exclusive (Sheets API convention). */
function gridRange(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) {
  return { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex };
}
