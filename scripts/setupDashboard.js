// One-time (re-runnable) script: builds a "Dashboard" tab in your Google
// Sheet with live KPI formulas and two charts, pulling straight from the
// Inventory/Orders/Deliveries tabs the bot writes to. No separate app —
// opening the Sheet IS the dashboard, and it updates itself as orders come in.
// Run with: npm run setup-dashboard (after `npm run setup-sheet`).
//
// Layout (row numbers matter — chart ranges below reference them directly):
//   1     Title
//   3-4   KPI header row / KPI value row
//   6-7   Inventory value + total delivery charges paid
//   9-13  "Orders by Status" mini table (source for the pie chart)
//   15-24 "Top Items by Units Sold" (QUERY-driven, source for the bar chart)
//   26-28 "Low Stock Items" table (QUERY-driven, action list — no chart needed)
//   30-34 "Sales Breakdown — Day/Week/Month" (Orders, Units Sold, Gross Sales,
//         GST Collected, Net Sales, Delivery Charges, Avg Order Value) —
//         current-period totals only, not a trend.
//   36-85 "Sales Trend" — a full P&L per period (Orders, Revenue, GST, Net
//         Sales, COGS, Gross Profit, Delivery Charges, Marketing Spend, Net
//         Profit, Margin %), one table+chart each for the last 14 days / 12
//         weeks / 12 months (see DAY_DATA_ROW / WEEK_DATA_ROW /
//         MONTH_DATA_ROW below, columns A:K). Each table is a *fixed*
//         calendar sequence (today back N-1 days/weeks/months) matched via
//         COUNTIFS/SUMIFS against hidden helper columns N:Z — so a period
//         with zero orders still shows up as a real 0, not a skipped row
//         that makes the chart draw a misleading diagonal across the gap.
//         The chart itself only plots Orders + Revenue (any more series
//         would be unreadable); the rest of the P&L lives in the table.
//
// Sales Breakdown assumptions (confirmed with the business owner):
//   - GST is 5%, already included in Orders!Total (tax-inclusive), so GST
//     collected = Total × 5/105 and net sales = Total × 100/105.
//   - Delivery charges are also folded into Orders!Total already — the
//     Delivery Charges column here is Deliveries!DeliveryCharge shown as its
//     own line for visibility, not added on top of Gross Sales.
//   - Every order counts as a sale the moment it's placed (payment happens
//     at placement), regardless of its delivery Status.
//   - "Day/Week/Month" are calendar periods: today since midnight, this
//     week since Monday, this month since the 1st — not trailing windows.
//   - Orders!Timestamp / Deliveries!Timestamp are ISO strings
//     ("2026-09-03T10:47:09.695Z" or plain "2026-09-02"); LEFT(...,10) +
//     DATEVALUE reads the YYYY-MM-DD prefix regardless of which shape it's in.

require('dotenv').config();
const { google } = require('googleapis');
const config = require('../src/config');

const DASHBOARD_SHEET = 'Dashboard';

// Sales Trend table start rows (1-indexed) — each QUERY formula below is
// written to just the top-left cell and spills downward, so these are also
// where the header sits (one row above) and what the charts' source ranges
// are computed from.
const DAY_DATA_ROW = 40;
const DAY_ROWS = 14; // last 14 days
const WEEK_DATA_ROW = 58;
const WEEK_ROWS = 12; // last 12 weeks
const MONTH_DATA_ROW = 74;
const MONTH_ROWS = 12; // last 12 months

// Every Sales Trend table has the same 11 columns (A:K) — only the first
// header label (Date/Week Of/Month) differs.
const TREND_HEADER = (periodLabel) => [
  periodLabel,
  'Orders',
  'Revenue',
  'GST (5%)',
  'Net Sales',
  'COGS',
  'Gross Profit',
  'Delivery Chg',
  'Marketing',
  'Net Profit',
  'Margin %',
];

(async () => {
  const auth = new google.auth.OAuth2(config.googleOAuthClientId, config.googleOAuthClientSecret);
  auth.setCredentials({ refresh_token: config.googleOAuthRefreshToken });
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.sheetId });
  let dashboardSheet = meta.data.sheets.find((s) => s.properties.title === DASHBOARD_SHEET);

  // Create the tab (as the first tab, so it's what you see on open) if it doesn't exist yet.
  if (!dashboardSheet) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: DASHBOARD_SHEET, index: 0, gridProperties: { rowCount: 60, columnCount: 12 } } } },
        ],
      },
    });
    dashboardSheet = res.data.replies[0].addSheet;
    console.log('Created Dashboard tab.');
  } else {
    console.log('Dashboard tab already exists — refreshing its contents.');
  }
  const sheetId = dashboardSheet.properties.sheetId;

  // Grow the grid *before* writing any formulas — the Sales Trend section's
  // hidden helper columns (K:N) and its data rows need more room than an
  // existing tab's original 60 rows x 12 columns, and writing to a cell
  // outside the current grid limits fails outright. Math.max so a tab that's
  // already bigger (e.g. someone manually added rows) never gets shrunk.
  const currentGrid = dashboardSheet.properties.gridProperties || {};
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                rowCount: Math.max(currentGrid.rowCount || 0, 1000),
                columnCount: Math.max(currentGrid.columnCount || 0, 26),
              },
            },
            fields: 'gridProperties.rowCount,gridProperties.columnCount',
          },
        },
      ],
    },
  });

  // ---------- Sales Breakdown formula builders ----------
  // The YYYY-MM-DD prefix of a Timestamp cell, parsed as a real date; blank/
  // unparseable cells fall back to 0 so they never match a period comparison.
  const ORDER_DATE = 'IFERROR(DATEVALUE(LEFT(Orders!B2:B,10)),0)';
  const DELIVERY_DATE = 'IFERROR(DATEVALUE(LEFT(Deliveries!B2:B,10)),0)';

  // Comparator suffixes for each calendar period, applied to both date exprs above.
  const TODAY_CMP = '=TODAY()';
  const WEEK_CMP = '>=(TODAY()-WEEKDAY(TODAY(),3))'; // Monday of the current week
  const MONTH_CMP = '>=DATE(YEAR(TODAY()),MONTH(TODAY()),1)'; // 1st of the current month

  /**
   * Builds one Sales Breakdown row's formulas for a given period comparator.
   * Wraps the money/qty columns in N(...) so a stray non-numeric cell (bad
   * seed/test data, a typo) coerces to 0 instead of blowing up the whole
   * SUMPRODUCT with #VALUE! — see the note above about rows 2-4 in Orders.
   */
  function periodFormulas(cmp) {
    const ordersMatch = `${ORDER_DATE}${cmp}`;
    const deliveriesMatch = `${DELIVERY_DATE}${cmp}`;
    const grossExpr = `SUMPRODUCT((${ordersMatch})*N(Orders!G2:G))`;
    const countExpr = `SUMPRODUCT((${ordersMatch})*1)`;
    return [
      `=${countExpr}`, // Orders
      `=SUMPRODUCT((${ordersMatch})*N(Orders!E2:E))`, // Units Sold
      `=${grossExpr}`, // Gross Sales (Total is GST + delivery inclusive)
      `=${grossExpr}*5/105`, // GST Collected
      `=${grossExpr}*100/105`, // Net Sales (excl. GST)
      `=SUMPRODUCT((${deliveriesMatch})*N(Deliveries!G2:G))`, // Delivery Charges
      `=IFERROR(${grossExpr}/${countExpr},0)`, // Avg Order Value
    ];
  }

  /**
   * KPI totals shown right next to a Sales Trend subheading (e.g. "By Day —
   * Last 14 Days  Σ Orders: 12  Σ Revenue: Nu. 34,000  Σ Net Profit: Nu.
   * 9,500") — so the reader gets the headline numbers as text, not just
   * implied by the chart next to it. Sums the table's own Orders(B),
   * Revenue(C) and Net Profit(J) columns over its exact row range
   * (dataRow..dataRow+count-1), landing in columns B:G, clear of the table
   * itself (which runs to column K) and the chart (which starts past that).
   */
  function trendTotals(dataRow, count) {
    const lastRow = dataRow + count - 1;
    return [
      'Σ Orders:',
      `=SUM(B${dataRow}:B${lastRow})`,
      'Σ Revenue:',
      `=SUM(C${dataRow}:C${lastRow})`,
      'Σ Net Profit:',
      `=SUM(J${dataRow}:J${lastRow})`,
    ];
  }

  // ---------- Formulas & labels ----------
  // USER_ENTERED so strings starting with "=" are evaluated as real formulas.
  const rows = {
    1: ['📊 SoleMate Kick — Dashboard'],
    3: ['Total Revenue', 'Orders Placed', 'Pending', 'Out for Delivery', 'Delivered', 'Low Stock Items'],
    4: [
      '=SUM(Orders!G2:G)',
      '=COUNTA(Orders!A2:A)',
      '=COUNTIF(Orders!K2:K,"Pending")',
      '=COUNTIF(Orders!K2:K,"Out for Delivery")',
      '=COUNTIF(Orders!K2:K,"Delivered")',
      '=SUMPRODUCT((Inventory!F2:F1000<>"")*(Inventory!F2:F1000<=3))',
    ],
    6: ['Inventory Value (cost basis)', '=SUMPRODUCT(Inventory!F2:F1000,Inventory!G2:G1000)'],
    7: ['Total Delivery Charges Paid', '=SUM(Deliveries!G2:G)'],
    9: ['Orders by Status'],
    10: ['Status', 'Count'],
    11: ['Pending', '=COUNTIF(Orders!K2:K,"Pending")'],
    12: ['Out for Delivery', '=COUNTIF(Orders!K2:K,"Out for Delivery")'],
    13: ['Delivered', '=COUNTIF(Orders!K2:K,"Delivered")'],
    15: ['Top Items by Units Sold'],
    16: ['Item', 'Units Sold'],
    17: ['=IFERROR(QUERY(Orders!D2:E,"select D, sum(E) where D is not null group by D order by sum(E) desc limit 8 label sum(E) \'\'",0),"")'],
    26: ['Low Stock Items (3 or fewer left)'],
    27: ['Brand', 'Item', 'Size', 'Color', 'Qty'],
    28: ['=IFERROR(QUERY(Inventory!B2:F,"select B,C,D,E,F where F<=3 order by F asc",0),"")'],
    30: ['📈 Sales Breakdown — Day / Week / Month'],
    31: ['Period', 'Orders', 'Units Sold', 'Gross Sales', 'GST Collected (5%)', 'Net Sales (excl. GST)', 'Delivery Charges', 'Avg Order Value'],
    32: ['Today', ...periodFormulas(TODAY_CMP)],
    33: ['This Week', ...periodFormulas(WEEK_CMP)],
    34: ['This Month', ...periodFormulas(MONTH_CMP)],
    36: ['📈 Sales Trend — Full P&L over Time'],
    38: ['By Day — Last 14 Days', ...trendTotals(DAY_DATA_ROW, DAY_ROWS)],
    39: TREND_HEADER('Date'),
    56: ['By Week — Last 12 Weeks (starting Monday)', ...trendTotals(WEEK_DATA_ROW, WEEK_ROWS)],
    57: TREND_HEADER('Week Of'),
    72: ['By Month — Last 12 Months', ...trendTotals(MONTH_DATA_ROW, MONTH_ROWS)],
    73: TREND_HEADER('Month'),
  };

  const data = Object.entries(rows).map(([rowNum, values]) => ({
    range: `${DASHBOARD_SHEET}!A${rowNum}`,
    values: [values],
  }));

  // Hidden helper columns (N:Z), one ARRAYFORMULA each. Orders/Deliveries/
  // Marketing timestamps are ISO strings, not real Date cells, so they can't
  // be matched against directly — these convert each sheet's date once into
  // plain keys (day/week-start/month, as yyyy-mm[-dd] text) that the Sales
  // Trend tables below match against with COUNTIFS/SUMIFS. Three sheets,
  // three independent day/week/month keys, because each has its own date
  // column (Orders!Timestamp, Deliveries!Timestamp, Marketing!PostDate).
  const orderDate = 'IFERROR(DATEVALUE(LEFT(Orders!B2:B,10)),0)';
  const deliveryDate = 'IFERROR(DATEVALUE(LEFT(Deliveries!B2:B,10)),0)';
  const marketingDate = 'IFERROR(DATEVALUE(LEFT(Marketing!D2:D,10)),0)';
  data.push(
    // N:R — Orders: Day key, Week key, Month key, Revenue, COGS (Qty × the
    // item's *current* Inventory CostPrice — a snapshot, not historical cost).
    { range: `${DASHBOARD_SHEET}!N2`, values: [[`=ARRAYFORMULA(IF(Orders!A2:A="","",TEXT(${orderDate},"yyyy-mm-dd")))`]] },
    {
      range: `${DASHBOARD_SHEET}!O2`,
      values: [[`=ARRAYFORMULA(IF(Orders!A2:A="","",TEXT(${orderDate}-WEEKDAY(${orderDate},3),"yyyy-mm-dd")))`]],
    },
    { range: `${DASHBOARD_SHEET}!P2`, values: [[`=ARRAYFORMULA(IF(Orders!A2:A="","",TEXT(${orderDate},"yyyy-mm")))`]] },
    { range: `${DASHBOARD_SHEET}!Q2`, values: [[`=ARRAYFORMULA(IF(Orders!A2:A="","",N(Orders!G2:G)))`]] },
    {
      range: `${DASHBOARD_SHEET}!R2`,
      values: [
        [
          `=ARRAYFORMULA(IF(Orders!A2:A="","",N(Orders!E2:E)*IFERROR(VLOOKUP(Orders!C2:C,Inventory!A:G,7,FALSE),0)))`,
        ],
      ],
    },
    // S:V — Deliveries: Day key, Week key, Month key, Delivery Charge.
    { range: `${DASHBOARD_SHEET}!S2`, values: [[`=ARRAYFORMULA(IF(Deliveries!A2:A="","",TEXT(${deliveryDate},"yyyy-mm-dd")))`]] },
    {
      range: `${DASHBOARD_SHEET}!T2`,
      values: [[`=ARRAYFORMULA(IF(Deliveries!A2:A="","",TEXT(${deliveryDate}-WEEKDAY(${deliveryDate},3),"yyyy-mm-dd")))`]],
    },
    { range: `${DASHBOARD_SHEET}!U2`, values: [[`=ARRAYFORMULA(IF(Deliveries!A2:A="","",TEXT(${deliveryDate},"yyyy-mm")))`]] },
    { range: `${DASHBOARD_SHEET}!V2`, values: [[`=ARRAYFORMULA(IF(Deliveries!A2:A="","",N(Deliveries!G2:G)))`]] },
    // W:Z — Marketing: Day key, Week key, Month key, Amount Spend.
    { range: `${DASHBOARD_SHEET}!W2`, values: [[`=ARRAYFORMULA(IF(Marketing!A2:A="","",TEXT(${marketingDate},"yyyy-mm-dd")))`]] },
    {
      range: `${DASHBOARD_SHEET}!X2`,
      values: [[`=ARRAYFORMULA(IF(Marketing!A2:A="","",TEXT(${marketingDate}-WEEKDAY(${marketingDate},3),"yyyy-mm-dd")))`]],
    },
    { range: `${DASHBOARD_SHEET}!Y2`, values: [[`=ARRAYFORMULA(IF(Marketing!A2:A="","",TEXT(${marketingDate},"yyyy-mm")))`]] },
    { range: `${DASHBOARD_SHEET}!Z2`, values: [[`=ARRAYFORMULA(IF(Marketing!A2:A="","",N(Marketing!E2:E)))`]] }
  );

  /**
   * The 10 formula columns (B:K) for one Sales Trend table — a full P&L per
   * period. `keyCols` picks which of the Orders/Deliveries/Marketing Day,
   * Week or Month key columns to match against, matching whichever period
   * this table (Day/Week/Month) is for. Column A (the period label itself)
   * is written separately per block, since it's a fixed calendar sequence,
   * not derived from these formulas.
   *
   * One plain formula per row (not one ARRAYFORMULA spilling the whole
   * column) — Google Sheets' SUMIFS does *not* reliably vectorize when its
   * criteria argument is a range wrapped in ARRAYFORMULA (a known quirk;
   * COUNTIFS does, SUMIFS silently returns 0/blank instead). A plain
   * single-cell SUMIFS/COUNTIFS per row has no such issue and is simple to
   * verify — so each row gets its own formula referencing just that row's A cell.
   */
  function trendFormulas(dataRow, count, keyCols) {
    // Builds one {range, values} push covering rows dataRow..dataRow+count-1
    // of a single column, `formulaFor(row)` producing that row's formula.
    const column = (col, formulaFor) => ({
      range: `${DASHBOARD_SHEET}!${col}${dataRow}:${col}${dataRow + count - 1}`,
      values: Array.from({ length: count }, (_, i) => [formulaFor(dataRow + i)]),
    });
    return [
      column('B', (r) => `=COUNTIFS($${keyCols.order}$2:$${keyCols.order}$1000,A${r})`), // Orders
      column('C', (r) => `=SUMIFS($Q$2:$Q$1000,$${keyCols.order}$2:$${keyCols.order}$1000,A${r})`), // Revenue
      column('D', (r) => `=C${r}*5/105`), // GST Collected
      column('E', (r) => `=C${r}*100/105`), // Net Sales (excl. GST)
      column('F', (r) => `=SUMIFS($R$2:$R$1000,$${keyCols.order}$2:$${keyCols.order}$1000,A${r})`), // COGS
      column('G', (r) => `=C${r}-F${r}`), // Gross Profit
      column('H', (r) => `=SUMIFS($V$2:$V$1000,$${keyCols.delivery}$2:$${keyCols.delivery}$1000,A${r})`), // Delivery Charges
      column('I', (r) => `=SUMIFS($Z$2:$Z$1000,$${keyCols.marketing}$2:$${keyCols.marketing}$1000,A${r})`), // Marketing Spend
      column('J', (r) => `=G${r}-H${r}-I${r}`), // Net Profit (Gross Profit − Delivery Charges − Marketing Spend)
      column('K', (r) => `=IFERROR(J${r}/C${r},0)`), // Margin % (Net Profit / Revenue)
    ];
  }

  // Sales Trend tables: a fixed calendar sequence (today back N-1
  // days/weeks/months) rather than only the days/weeks/months that actually
  // had an order — every SUMIFS/COUNTIFS above naturally returns 0 for a
  // period with no orders instead of the row being skipped, so the chart
  // shows a flat 0 instead of a misleading diagonal jump across a gap.
  data.push(
    // By Day: TODAY()-13 .. TODAY(), ascending.
    {
      range: `${DASHBOARD_SHEET}!A${DAY_DATA_ROW}`,
      values: [[`=ARRAYFORMULA(TEXT(TODAY()-SEQUENCE(${DAY_ROWS},1,${DAY_ROWS - 1},-1),"yyyy-mm-dd"))`]],
    },
    ...trendFormulas(DAY_DATA_ROW, DAY_ROWS, { order: 'N', delivery: 'S', marketing: 'W' }),
    // By Week: this week's Monday, back WEEK_ROWS-1 more weeks, ascending.
    {
      range: `${DASHBOARD_SHEET}!A${WEEK_DATA_ROW}`,
      values: [
        [`=ARRAYFORMULA(TEXT(TODAY()-WEEKDAY(TODAY(),3)-7*SEQUENCE(${WEEK_ROWS},1,${WEEK_ROWS - 1},-1),"yyyy-mm-dd"))`],
      ],
    },
    ...trendFormulas(WEEK_DATA_ROW, WEEK_ROWS, { order: 'O', delivery: 'T', marketing: 'X' }),
    // By Month: the 1st of this month, back MONTH_ROWS-1 more months, ascending.
    {
      range: `${DASHBOARD_SHEET}!A${MONTH_DATA_ROW}`,
      values: [
        [
          `=ARRAYFORMULA(TEXT(EDATE(DATE(YEAR(TODAY()),MONTH(TODAY()),1),-SEQUENCE(${MONTH_ROWS},1,${MONTH_ROWS - 1},-1)),"yyyy-mm"))`,
        ],
      ],
    },
    ...trendFormulas(MONTH_DATA_ROW, MONTH_ROWS, { order: 'P', delivery: 'U', marketing: 'Y' })
  );

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
  console.log('Formulas written.');

  // ---------- Formatting: title, section headers, KPI numbers, currency ----------
  // Palette lifted from the blush/lavender budget-dashboard reference:
  //   LAVENDER   dusty blue-lavender header bands ("#8B93B7")
  //   BLUSH      pale blush section/table backgrounds ("#F9ECE8")
  //   BLUSH_ROW  faint blush zebra-row tint ("#FCF6F4")
  //   CORAL      coral accent for alerts / low-stock ("#F3C8BF")
  //   INK        dark navy-grey text ("#3D4053")
  const LAVENDER = { red: 0.545, green: 0.576, blue: 0.718 };
  const BLUSH = { red: 0.976, green: 0.925, blue: 0.91 };
  const BLUSH_ROW = { red: 0.988, green: 0.965, blue: 0.957 };
  const CORAL = { red: 0.953, green: 0.784, blue: 0.749 };
  const INK = { red: 0.239, green: 0.251, blue: 0.325 };
  const WHITE = { red: 1, green: 1, blue: 1 };

  const formatRequests = [
    // Page wash: soft blush background behind the whole dashboard grid
    {
      repeatCell: {
        range: gridRange(sheetId, 0, 90, 0, 26),
        cell: { userEnteredFormat: { backgroundColor: BLUSH_ROW } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    },
    // Helper columns N:Z (Orders/Deliveries/Marketing Day/Week/Month keys +
    // Revenue/COGS/DeliveryCharge/MarketingSpend passthroughs) feed the
    // Sales Trend tables below but aren't meant to be read directly.
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 13, endIndex: 26 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser',
      },
    },
    // Title: big, bold, lavender band, merged across A1:F1
    {
      mergeCells: { range: gridRange(sheetId, 0, 1, 0, 6), mergeType: 'MERGE_ALL' },
    },
    {
      repeatCell: {
        range: gridRange(sheetId, 0, 1, 0, 6),
        cell: {
          userEnteredFormat: {
            backgroundColor: LAVENDER,
            textFormat: { foregroundColor: WHITE, fontSize: 16, bold: true },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    // KPI header row (row 3) and value row (row 4) styling
    {
      repeatCell: {
        range: gridRange(sheetId, 2, 3, 0, 6),
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: INK }, backgroundColor: BLUSH } },
        fields: 'userEnteredFormat(textFormat,backgroundColor)',
      },
    },
    {
      repeatCell: {
        range: gridRange(sheetId, 3, 4, 0, 6),
        cell: { userEnteredFormat: { textFormat: { fontSize: 14, bold: true, foregroundColor: INK } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    // Currency format for revenue + inventory value + delivery charges cells
    ...[gridRange(sheetId, 3, 4, 0, 1), gridRange(sheetId, 5, 6, 1, 2), gridRange(sheetId, 6, 7, 1, 2)].map((range) => ({
      repeatCell: {
        range,
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    })),
    // Section title styling (Orders by Status / Top Items / Low Stock) — lavender band, white text
    ...[8, 14, 25].map((rowIdx0) => ({
      repeatCell: {
        range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 0, 6),
        cell: {
          userEnteredFormat: {
            backgroundColor: LAVENDER,
            textFormat: { bold: true, fontSize: 12, foregroundColor: WHITE },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })),
    // Sub-header rows under each section title (Status/Count, Item/Units Sold, Brand/Item/...) — pale blush
    ...[9, 15, 26].map((rowIdx0) => ({
      repeatCell: {
        range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 0, 6),
        cell: { userEnteredFormat: { backgroundColor: BLUSH, textFormat: { bold: true, foregroundColor: INK } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })),
    // Sales Breakdown: title band merged across A30:H30
    { mergeCells: { range: gridRange(sheetId, 29, 30, 0, 8), mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: gridRange(sheetId, 29, 30, 0, 8),
        cell: {
          userEnteredFormat: {
            backgroundColor: LAVENDER,
            textFormat: { bold: true, fontSize: 12, foregroundColor: WHITE },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    // Sales Breakdown: header row (31) — pale blush, wrapped so long labels
    // like "GST Collected (5%)" don't get clipped by their neighbor
    {
      repeatCell: {
        range: gridRange(sheetId, 30, 31, 0, 8),
        cell: {
          userEnteredFormat: {
            backgroundColor: BLUSH,
            textFormat: { bold: true, foregroundColor: INK },
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)',
      },
    },
    // Sales Breakdown: bold period labels (Today / This Week / This Month)
    {
      repeatCell: {
        range: gridRange(sheetId, 31, 34, 0, 1),
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: INK } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    // Sales Breakdown: currency formatting on the money columns (Gross Sales,
    // GST Collected, Net Sales, Delivery Charges, Avg Order Value)
    {
      repeatCell: {
        range: gridRange(sheetId, 31, 34, 3, 8),
        cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    // Sales Trend: title band merged across A36:K36 (full P&L table width)
    { mergeCells: { range: gridRange(sheetId, 35, 36, 0, 11), mergeType: 'MERGE_ALL' } },
    {
      repeatCell: {
        range: gridRange(sheetId, 35, 36, 0, 11),
        cell: {
          userEnteredFormat: {
            backgroundColor: LAVENDER,
            textFormat: { bold: true, fontSize: 12, foregroundColor: WHITE },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    // Sales Trend: "By Day/Week/Month" subheadings — bold italic, no fill
    ...[37, 55, 71].map((rowIdx0) => ({
      repeatCell: {
        range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 0, 1),
        cell: { userEnteredFormat: { textFormat: { bold: true, italic: true, foregroundColor: INK } } },
        fields: 'userEnteredFormat.textFormat',
      },
    })),
    // Sales Trend: the "Σ Orders: X  Σ Revenue: Nu. Y  Σ Net Profit: Nu. Z"
    // KPI totals sitting next to each subheading — bold (not italic, these
    // are numbers to read), with currency on the Revenue and Net Profit values.
    ...[37, 55, 71].map((rowIdx0) => ({
      repeatCell: {
        range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 1, 7),
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: INK } } },
        fields: 'userEnteredFormat.textFormat',
      },
    })),
    ...[37, 55, 71].flatMap((rowIdx0) => [
      {
        repeatCell: {
          range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 4, 5),
          cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      {
        repeatCell: {
          range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 6, 7),
          cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    ]),
    // Sales Trend: each table's header row (11 P&L columns) — pale blush, wrapped
    ...[38, 56, 72].map((rowIdx0) => ({
      repeatCell: {
        range: gridRange(sheetId, rowIdx0, rowIdx0 + 1, 0, 11),
        cell: { userEnteredFormat: { backgroundColor: BLUSH, textFormat: { bold: true, foregroundColor: INK }, wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy)',
      },
    })),
    // Sales Trend: currency formatting on every money column (Revenue, GST,
    // Net Sales, COGS, Gross Profit, Delivery Charges, Marketing, Net Profit —
    // columns C:J) and percentage formatting on Margin % (column K)
    ...[DAY_DATA_ROW, WEEK_DATA_ROW, MONTH_DATA_ROW].flatMap((dataRow, i) => {
      const count = [DAY_ROWS, WEEK_ROWS, MONTH_ROWS][i];
      const startRow = dataRow - 1;
      const endRow = startRow + count;
      return [
        {
          repeatCell: {
            range: gridRange(sheetId, startRow, endRow, 2, 10),
            cell: { userEnteredFormat: { numberFormat: { type: 'CURRENCY', pattern: '"Nu. "#,##0.00' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
        {
          repeatCell: {
            range: gridRange(sheetId, startRow, endRow, 10, 11),
            cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
      ];
    }),
    // Column widths so labels aren't clipped
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 200 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 8 },
        properties: { pixelSize: 130 },
        fields: 'pixelSize',
      },
    },
    // The Sales Trend table runs wider than the other sections (11 columns,
    // A:K) — same pixel width for the extra columns (I:K) so its P&L labels
    // (Delivery Chg, Marketing, Net Profit, Margin %) don't get clipped.
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 8, endIndex: 11 },
        properties: { pixelSize: 130 },
        fields: 'pixelSize',
      },
    },
    // Conditional formatting: highlight low-stock quantities in the Low
    // Stock table (col E, rows 29+). Capped at row 35 — just before the
    // Sales Trend section starts at row 36 — so it can't bleed into that
    // table's GST column further down (whose values are unrelated small numbers).
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [gridRange(sheetId, 27, 35, 4, 5)],
          booleanRule: {
            condition: { type: 'NUMBER_LESS_THAN_EQ', values: [{ userEnteredValue: '3' }] },
            format: { backgroundColor: CORAL, textFormat: { bold: true, foregroundColor: INK } },
          },
        },
        index: 0,
      },
    },
    // Tab color to match the lavender theme
    {
      updateSheetProperties: {
        properties: { sheetId, tabColor: LAVENDER },
        fields: 'tabColor',
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: formatRequests } });
  console.log('Formatting applied.');

  // ---------- Charts ----------
  // Remove any charts this script previously created, so re-running doesn't pile up duplicates.
  const existingCharts = (dashboardSheet.charts || []).map((c) => ({ deleteEmbeddedObject: { objectId: c.chartId } }));
  if (existingCharts.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: existingCharts } });
  }

  const chartRequests = [
    {
      addChart: {
        chart: {
          spec: {
            title: 'Orders by Status',
            titleTextFormat: { foregroundColor: INK, bold: true },
            backgroundColor: WHITE,
            pieChart: {
              // Labeled slices (category + value right on the chart) instead
              // of a separate legend box — reads at a glance, analytics-style.
              legendPosition: 'LABELED_LEGEND',
              domain: { sourceRange: { sources: [gridRange(sheetId, 10, 13, 0, 1)] } },
              series: { sourceRange: { sources: [gridRange(sheetId, 10, 13, 1, 2)] } },
              pieHole: 0.4,
            },
          },
          position: { overlayPosition: { anchorCell: { sheetId, rowIndex: 0, columnIndex: 7 }, widthPixels: 380, heightPixels: 260 } },
        },
      },
    },
    {
      addChart: {
        chart: {
          spec: {
            title: 'Top Items by Units Sold',
            titleTextFormat: { foregroundColor: INK, bold: true },
            backgroundColor: WHITE,
            basicChart: {
              chartType: 'BAR',
              legendPosition: 'NO_LEGEND',
              axis: [
                { position: 'BOTTOM_AXIS', title: 'Units Sold', viewWindowOptions: { viewWindowMin: 0 } },
                { position: 'LEFT_AXIS', title: 'Item' },
              ],
              domains: [{ domain: { sourceRange: { sources: [gridRange(sheetId, 16, 24, 0, 1)] } } }],
              series: [
                {
                  series: { sourceRange: { sources: [gridRange(sheetId, 16, 24, 1, 2)] } },
                  targetAxis: 'BOTTOM_AXIS',
                  color: LAVENDER,
                  // Exact unit count printed at the end of each bar, not just implied by length.
                  dataLabel: { type: 'DATA', textFormat: { fontSize: 9, foregroundColor: INK } },
                },
              ],
            },
          },
          position: { overlayPosition: { anchorCell: { sheetId, rowIndex: 8, columnIndex: 7 }, widthPixels: 380, heightPixels: 300 } },
        },
      },
    },
    ...buildTrendChart({
      sheetId,
      title: 'Orders & Revenue — Last 14 Days',
      dataRow: DAY_DATA_ROW,
      rows: DAY_ROWS,
      axisTitle: 'Date',
      anchorRowIndex: 35,
      colors: { INK, LAVENDER, CORAL, WHITE },
    }),
    ...buildTrendChart({
      sheetId,
      title: 'Orders & Revenue — Last 12 Weeks',
      dataRow: WEEK_DATA_ROW,
      rows: WEEK_ROWS,
      axisTitle: 'Week Of',
      anchorRowIndex: 53,
      colors: { INK, LAVENDER, CORAL, WHITE },
    }),
    ...buildTrendChart({
      sheetId,
      title: 'Orders & Revenue — Last 12 Months',
      dataRow: MONTH_DATA_ROW,
      rows: MONTH_ROWS,
      axisTitle: 'Month',
      anchorRowIndex: 71,
      colors: { INK, LAVENDER, CORAL, WHITE },
    }),
  ];

  await sheets.spreadsheets.batchUpdate({ spreadsheetId: config.sheetId, requestBody: { requests: chartRequests } });
  console.log('✅ Dashboard ready — open the Sheet and check the "Dashboard" tab.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

/** Builds a GridRange. Row/column indexes are 0-based, end-exclusive (Sheets API convention). */
function gridRange(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) {
  return { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex };
}

/**
 * One combo chart (Orders as columns on the left axis, Revenue as a line on
 * the right axis) reading a Date/Week/Month + Orders + Revenue table that
 * starts at `dataRow` (1-indexed) and spills down `rows` rows. Shared by the
 * Day/Week/Month Sales Trend sections so the three charts stay identical
 * apart from their source range and label.
 */
function buildTrendChart({ sheetId, title, dataRow, rows, axisTitle, anchorRowIndex, colors }) {
  const { INK, LAVENDER, CORAL, WHITE } = colors;
  const startRow = dataRow - 1; // to 0-based
  const endRow = startRow + rows;
  return [
    {
      addChart: {
        chart: {
          spec: {
            title,
            titleTextFormat: { foregroundColor: INK, bold: true },
            backgroundColor: WHITE,
            basicChart: {
              chartType: 'COMBO',
              legendPosition: 'BOTTOM_LEGEND',
              axis: [
                { position: 'BOTTOM_AXIS', title: axisTitle },
                // Orders axis pinned to start at 0 so bar heights are
                // directly comparable, not just relative to each other.
                { position: 'LEFT_AXIS', title: 'Orders', viewWindowOptions: { viewWindowMin: 0 } },
                { position: 'RIGHT_AXIS', title: 'Revenue (Nu.)', viewWindowOptions: { viewWindowMin: 0 } },
              ],
              domains: [{ domain: { sourceRange: { sources: [gridRange(sheetId, startRow, endRow, 0, 1)] } } }],
              series: [
                {
                  series: { sourceRange: { sources: [gridRange(sheetId, startRow, endRow, 1, 2)] } },
                  targetAxis: 'LEFT_AXIS',
                  type: 'COLUMN',
                  color: LAVENDER,
                  // Exact order count printed on each bar.
                  dataLabel: { type: 'DATA', textFormat: { fontSize: 8, foregroundColor: INK } },
                },
                {
                  series: { sourceRange: { sources: [gridRange(sheetId, startRow, endRow, 2, 3)] } },
                  targetAxis: 'RIGHT_AXIS',
                  type: 'LINE',
                  color: CORAL,
                  lineStyle: { width: 3, type: 'SOLID' },
                  pointStyle: { shape: 'CIRCLE', size: 6 },
                  // Exact revenue printed at each point — inherits the
                  // column's currency format automatically.
                  dataLabel: { type: 'DATA', textFormat: { fontSize: 8, foregroundColor: INK, bold: true } },
                },
              ],
            },
          },
          // Anchored past column K (index 10) — the P&L table now runs A:K,
          // one column wider than the two charts above it that still anchor at H.
          position: { overlayPosition: { anchorCell: { sheetId, rowIndex: anchorRowIndex, columnIndex: 12 }, widthPixels: 560, heightPixels: 280 } },
        },
      },
    },
  ];
}
