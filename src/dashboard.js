// Handles the "📊 Dashboard" flow: after the DASHBOARD wizard asks which
// period, this computes live stats for that period and replies with a text
// summary. No chart images — a text-only summary keeps it fast and doesn't
// clutter the chat, and staff get the underlying breakdowns as plain lines
// instead (Top Items, Revenue by Month, Marketing Spend by Platform).

const analyticsRepo = require('./repos/analyticsRepo');
const { money } = require('./utils/format');

const PERIOD_LABELS = {
  today: 'Today',
  week: 'This Week _(last 7 days)_',
  month: 'This Month _(last 30 days)_',
  all: 'All Time',
};

async function sendDashboard(ctx, period = 'all') {
  await ctx.reply('📊 Crunching the numbers...');

  const stats = await analyticsRepo.getStats(period);
  const periodLabel = PERIOD_LABELS[period] || PERIOD_LABELS.all;

  await ctx.reply(
    `📊 *SoleMate Kick — Dashboard*\n_${periodLabel}_\n─────────────────\n\n` +
      `*Sales*\n` +
      `💰 Total Revenue: ${money(stats.totalRevenue)}\n` +
      `📦 Orders Placed: ${stats.totalOrders}\n` +
      `📈 Avg. Order Value: ${money(stats.avgOrderValue)}\n` +
      (stats.bestSeller ? `🥇 Best Seller: ${stats.bestSeller}\n` : '') +
      `\n*Profitability*\n` +
      `🏷️ Cost of Goods Sold: ${money(stats.costOfGoodsSold)}\n` +
      `💵 Gross Profit: ${money(stats.grossProfit)} (${stats.grossMarginPct.toFixed(0)}% margin)\n` +
      `🧮 Net Profit: ${money(stats.netProfit)} (${stats.netMarginPct.toFixed(0)}% margin)\n` +
      `   _after delivery charges + marketing spend_\n` +
      `\n*Customers*\n` +
      `🙋 Unique Customers: ${stats.totalCustomers}\n` +
      `🔁 Repeat Customers: ${stats.repeatCustomers} (${stats.repeatCustomerPct.toFixed(0)}%)\n` +
      `\n*Fulfillment*\n` +
      `✅ Delivered: ${stats.ordersByStatus.Delivered}/${stats.totalOrders} (${stats.deliveredPct.toFixed(0)}%)\n` +
      `🚚 Delivery Charges Paid: ${money(stats.totalDeliveryCharges)}\n` +
      `\n*Inventory* _(current, not limited to the period above)_\n` +
      `🏷️ Inventory Value: ${money(stats.inventoryValue)}\n` +
      `⚠️ Low Stock Items: ${stats.lowStock.length}\n` +
      `\n*Marketing*\n` +
      `📣 Total Spend: ${money(stats.totalMarketingSpend)}`,
    { parse_mode: 'Markdown' }
  );

  if (stats.topItems.length > 0) {
    const lines = stats.topItems.map((i) => `• ${i.itemDesc} — ${i.unitsSold} sold`).join('\n');
    await ctx.reply(`🏆 *Top Items*\n${lines}`, { parse_mode: 'Markdown' });
  }

  if (stats.revenueByMonth.length > 0) {
    const lines = stats.revenueByMonth.map((r) => `• ${r.month}: ${money(r.amount)}`).join('\n');
    await ctx.reply(`📈 *Revenue by Month*\n${lines}`, { parse_mode: 'Markdown' });
  }

  if (stats.spendByPlatform.length > 0) {
    const lines = stats.spendByPlatform.map((p) => `• ${p.platform}: ${money(p.amount)}`).join('\n');
    await ctx.reply(`📣 *Marketing Spend by Platform*\n${lines}`, { parse_mode: 'Markdown' });
  }

  // Low stock list as text — an action list, not a period-scoped stat.
  if (stats.lowStock.length > 0) {
    const lines = stats.lowStock
      .map((i) => `• ${i.Brand} ${i.Name} (${i.Size}, ${i.Color}) — ${i.Quantity} left`)
      .join('\n');
    await ctx.reply(`⚠️ *Low Stock* (${analyticsRepo.LOW_STOCK_THRESHOLD} or fewer):\n${lines}`, {
      parse_mode: 'Markdown',
    });
  }
}

module.exports = { sendDashboard };
