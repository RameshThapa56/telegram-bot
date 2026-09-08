// Aggregates numbers across the other three repos for the bot's /dashboard
// view. Kept separate from inventoryRepo/ordersRepo/deliveriesRepo because
// this is *reporting* logic (grouping, summing, ranking), not raw data access.

const inventoryRepo = require('./inventoryRepo');
const ordersRepo = require('./ordersRepo');
const deliveriesRepo = require('./deliveriesRepo');
const marketingRepo = require('./marketingRepo');

const LOW_STOCK_THRESHOLD = 3;

/**
 * Parses a sheet cell as a number, treating anything that isn't a real
 * number (blank, text, a mis-shifted column from a malformed row) as 0
 * instead of NaN — so one bad row in the sheet can't poison a whole
 * reduce() sum into NaN for every KPI on the dashboard.
 */
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Reduces a date-ish cell to a "YYYY-MM" bucket. A cell typed as "2026-09-04"
 * comes back from the Sheets API as that string, but Google Sheets silently
 * reformats a column it recognizes as a date — so once that happens, the
 * *same* cell instead comes back as a serial day-number (e.g. 46269) under
 * valueRenderOption: 'UNFORMATTED_VALUE'. Handle both so month grouping
 * doesn't fall over depending on how a column happens to be formatted.
 */
function toMonthKey(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Sheets serial date: days since the 1899-12-30 epoch.
    const ms = (value - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 7);
  }
  return String(value || '').slice(0, 7);
}

/**
 * Whether a Timestamp/PostDate cell falls inside the requested period.
 * 'today' = same calendar day as now; 'week'/'month' are rolling windows
 * (last 7 / last 30 days, including today) rather than calendar
 * week/month — simplest thing that matches what a "today, week, month"
 * dashboard picker means to non-technical staff. 'all' (or anything else) skips filtering.
 */
function isWithinPeriod(value, period) {
  if (!period || period === 'all') return true;
  const ts = new Date(value);
  if (Number.isNaN(ts.getTime())) return false;

  const now = new Date();
  if (period === 'today') return ts.toDateString() === now.toDateString();
  if (period === 'week') return now - ts <= 7 * 86400 * 1000;
  if (period === 'month') return now - ts <= 30 * 86400 * 1000;
  return true;
}

/**
 * A multi-item order has one Orders row per item, all sharing an OrderID —
 * fine for revenue/units sums (each row is a disjoint slice of money/stock),
 * but counting rows would count one order twice for anything "per order"
 * (order counts, average order value, repeat-customer rate). This collapses
 * back to one representative row per OrderID for those.
 */
function dedupeByOrderId(rows) {
  const mostRecentByOrderId = new Map();
  for (const row of rows) {
    const existing = mostRecentByOrderId.get(row.OrderID);
    if (!existing || new Date(row.Timestamp) > new Date(existing.Timestamp)) {
      mostRecentByOrderId.set(row.OrderID, row);
    }
  }
  return [...mostRecentByOrderId.values()];
}

async function getStats(period = 'all') {
  const [allOrders, inventory, allDeliveries, allMarketing] = await Promise.all([
    ordersRepo.listAll(),
    inventoryRepo.listAll(),
    deliveriesRepo.listAll(),
    marketingRepo.listAll(),
  ]);

  // Inventory is a current-state snapshot (stock on hand), not an
  // event log — it isn't filtered by period. Orders/deliveries/marketing
  // are events with a Timestamp/PostDate, so those are.
  const orders = allOrders.filter((o) => isWithinPeriod(o.Timestamp, period));
  const deliveries = allDeliveries.filter((d) => isWithinPeriod(d.Timestamp, period));
  const marketing = allMarketing.filter((m) => isWithinPeriod(m.PostDate || m.Timestamp, period));

  const totalRevenue = orders.reduce((sum, o) => sum + safeNumber(o.Total), 0);
  const totalDeliveryCharges = deliveries.reduce((sum, d) => sum + safeNumber(d.DeliveryCharge), 0);
  const inventoryValue = inventory.reduce((sum, i) => sum + safeNumber(i.Quantity) * safeNumber(i.CostPrice), 0);
  const totalMarketingSpend = marketing.reduce((sum, m) => sum + safeNumber(m.AmountSpend), 0);

  // Profitability. Cost of goods sold looks up each order's item by ItemID
  // against *current* inventory cost — the sheet doesn't record cost-at-time-
  // of-sale, so this is a snapshot, not a historically-accurate COGS. An
  // order whose item was since deleted from Inventory costs 0 (falls out of
  // the map) rather than breaking the whole calculation.
  const costByItemId = new Map(inventory.map((i) => [i.ItemID, safeNumber(i.CostPrice)]));
  const costOfGoodsSold = orders.reduce(
    (sum, o) => sum + safeNumber(o.Qty) * (costByItemId.get(o.ItemID) || 0),
    0
  );
  const grossProfit = totalRevenue - costOfGoodsSold;
  const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  // Net profit also nets out delivery charges paid to drivers and marketing
  // spend — the two other real cash costs already tracked in this system.
  const netProfit = grossProfit - totalDeliveryCharges - totalMarketingSpend;
  const netMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // One row per distinct order (not per item row) for every "per order" stat below.
  const distinctOrders = dedupeByOrderId(orders);

  const ordersByStatus = { Pending: 0, 'Out for Delivery': 0, Delivered: 0 };
  for (const o of distinctOrders) {
    if (ordersByStatus[o.Status] !== undefined) ordersByStatus[o.Status] += 1;
  }

  const lowStock = inventory
    .filter((i) => safeNumber(i.Quantity) <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => safeNumber(a.Quantity) - safeNumber(b.Quantity));

  const unitsSoldByItem = new Map();
  for (const o of orders) {
    const prev = unitsSoldByItem.get(o.ItemDesc) || 0;
    unitsSoldByItem.set(o.ItemDesc, prev + safeNumber(o.Qty));
  }
  const topItems = [...unitsSoldByItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([itemDesc, unitsSold]) => ({ itemDesc, unitsSold }));

  const avgOrderValue = distinctOrders.length > 0 ? totalRevenue / distinctOrders.length : 0;
  const deliveredPct = distinctOrders.length > 0 ? (ordersByStatus.Delivered / distinctOrders.length) * 100 : 0;
  const bestSeller = topItems.length > 0 ? topItems[0].itemDesc : null;

  // Revenue trend sums every item row (each is a disjoint slice of revenue);
  // the orders-count trend groups by distinct order so a multi-item order
  // counts once.
  const revenueByMonthMap = new Map();
  for (const o of orders) {
    const month = toMonthKey(o.Timestamp);
    if (!month) continue;
    revenueByMonthMap.set(month, (revenueByMonthMap.get(month) || 0) + safeNumber(o.Total));
  }
  const ordersByMonthMap = new Map();
  for (const o of distinctOrders) {
    const month = toMonthKey(o.Timestamp);
    if (!month) continue;
    ordersByMonthMap.set(month, (ordersByMonthMap.get(month) || 0) + 1);
  }
  const revenueByMonth = [...revenueByMonthMap.entries()]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const ordersByMonth = [...ordersByMonthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Customers: repeat-customer rate is a simple loyalty signal, grouped by phone.
  const ordersByCustomer = new Map();
  for (const o of distinctOrders) {
    if (!o.CustomerPhone) continue;
    ordersByCustomer.set(o.CustomerPhone, (ordersByCustomer.get(o.CustomerPhone) || 0) + 1);
  }
  const totalCustomers = ordersByCustomer.size;
  const repeatCustomers = [...ordersByCustomer.values()].filter((n) => n > 1).length;
  const repeatCustomerPct = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;

  const spendByPlatformMap = new Map();
  const spendByMonthMap = new Map();
  for (const m of marketing) {
    const amount = safeNumber(m.AmountSpend);
    spendByPlatformMap.set(m.Platform, (spendByPlatformMap.get(m.Platform) || 0) + amount);

    const month = toMonthKey(m.PostDate);
    if (month) spendByMonthMap.set(month, (spendByMonthMap.get(month) || 0) + amount);
  }
  const spendByPlatform = [...spendByPlatformMap.entries()]
    .map(([platform, amount]) => ({ platform, amount }))
    .sort((a, b) => b.amount - a.amount);
  const spendByMonth = [...spendByMonthMap.entries()]
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalRevenue,
    totalDeliveryCharges,
    inventoryValue,
    totalOrders: distinctOrders.length,
    avgOrderValue,
    deliveredPct,
    bestSeller,
    ordersByStatus,
    lowStock,
    topItems,
    revenueByMonth,
    ordersByMonth,
    totalCustomers,
    repeatCustomers,
    repeatCustomerPct,
    costOfGoodsSold,
    grossProfit,
    grossMarginPct,
    netProfit,
    netMarginPct,
    totalMarketingSpend,
    spendByPlatform,
    spendByMonth,
  };
}

module.exports = { getStats, LOW_STOCK_THRESHOLD };
