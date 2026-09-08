const sheets = require('../google/sheetsClient');
const { newOrderId } = require('../utils/ids');

const SHEET = 'Orders';

async function listAll() {
  return sheets.getRowsAsObjects(SHEET);
}

/** First raw sheet row matching this OrderID. For a multi-item order this is
 * only ONE of its item rows — use getOrderSummary() to get every item. */
async function findById(orderId) {
  const rows = await listAll();
  return rows.find((r) => r.OrderID === orderId);
}

/** Every raw sheet row sharing this OrderID — one per item on the order. */
async function findAllByOrderId(orderId) {
  const rows = await listAll();
  return rows.filter((r) => r.OrderID === orderId);
}

/**
 * Collapses a (possibly multi-item) order's rows into one object: the fields
 * shared by every row (customer, delivery, payment, status, ...) plus an
 * `Items` array (one entry per row) and a `Total` summed across them. Every
 * flow that displays or messages about an order works off this shape rather
 * than a raw row, so it never has to special-case single- vs multi-item.
 */
function toOrderSummary(orderRows) {
  const first = orderRows[0];
  const items = orderRows.map((r) => ({
    ItemID: r.ItemID,
    ItemDesc: r.ItemDesc,
    Qty: Number(r.Qty),
    Price: Number(r.Price),
    Total: Number(r.Total),
  }));
  return {
    OrderID: first.OrderID,
    Timestamp: first.Timestamp,
    DeliveryLocation: first.DeliveryLocation,
    CustomerName: first.CustomerName,
    CustomerPhone: first.CustomerPhone,
    Status: first.Status,
    CreatedBy: first.CreatedBy,
    PaymentMethod: first.PaymentMethod,
    BankName: first.BankName,
    JournalNumber: first.JournalNumber,
    Items: items,
    Total: items.reduce((sum, i) => sum + i.Total, 0),
  };
}

/** One summary object per distinct OrderID among `rows`, newest first. */
function summarizeByOrderId(rows, limit) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.OrderID)) groups.set(row.OrderID, []);
    groups.get(row.OrderID).push(row);
  }
  return [...groups.values()]
    .map(toOrderSummary)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, limit);
}

/** The full order (every item, combined total) behind one OrderID, or null. */
async function getOrderSummary(orderId) {
  const orderRows = await findAllByOrderId(orderId);
  if (!orderRows.length) return null;
  return toOrderSummary(orderRows);
}

/** Orders still awaiting a delivery — used to build the "pick an order" list when logging a delivery. Excludes ones already "Out for Delivery" or "Delivered". */
async function listPending(limit = 15) {
  const rows = await listAll();
  return summarizeByOrderId(
    rows.filter((r) => r.Status === 'Pending'),
    limit
  );
}

/**
 * Saves a new order — one sheet row per item, all sharing a freshly minted
 * OrderID, timestamp and customer/delivery/payment details. `items` is
 * `[{ itemId, itemDesc, qty, price }, ...]`; a single-item order is just the
 * one-element case of the same shape.
 */
async function create({
  items,
  deliveryLocation,
  customerName,
  customerPhone,
  paymentMethod,
  bankName,
  journalNumber,
  createdBy,
}) {
  const orderId = newOrderId();
  const timestamp = new Date().toISOString();

  const rows = items.map(({ itemId, itemDesc, qty, price }) => ({
    OrderID: orderId,
    Timestamp: timestamp,
    ItemID: itemId,
    ItemDesc: itemDesc,
    Qty: qty,
    Price: price,
    Total: Number(qty) * Number(price),
    DeliveryLocation: deliveryLocation,
    CustomerName: customerName,
    CustomerPhone: customerPhone,
    Status: 'Pending',
    CreatedBy: createdBy,
    PaymentMethod: paymentMethod || '',
    BankName: bankName || '',
    JournalNumber: journalNumber || '',
  }));
  await sheets.appendRows(SHEET, rows);

  const total = rows.reduce((sum, r) => sum + r.Total, 0);
  return { OrderID: orderId, Total: total };
}

/** Sets `status` on every row of a (possibly multi-item) order at once, so a
 * multi-item order never ends up with some rows in one status and others in
 * another. Shared by updateStatus() and markDelivered() below. */
async function setStatusForOrder(orderId, status) {
  const orderRows = await findAllByOrderId(orderId);
  if (!orderRows.length) throw new Error(`Order ${orderId} not found`);
  await Promise.all(orderRows.map((row) => sheets.updateCell(SHEET, row._rowNumber, 'Status', status)));
  return orderRows.map((row) => ({ ...row, Status: status }));
}

async function updateStatus(orderId, status) {
  await setStatusForOrder(orderId, status);
}

/**
 * Orders out for delivery but not yet confirmed Delivered — used by the
 * "📝 Feedback" menu (see flows/feedbackFlow.js): staff pick one once the
 * customer actually has it, which sends the feedback request AND flips the
 * order to Delivered in the same step (see markDelivered below).
 */
async function listOutForDelivery(limit = 15) {
  const rows = await listAll();
  return summarizeByOrderId(
    rows.filter((r) => r.Status === 'Out for Delivery'),
    limit
  );
}

/**
 * Flips Status -> 'Delivered' on every row of a (possibly multi-item) order
 * at once. Called right after a feedback request is generated for that
 * order (see flows/feedbackFlow.js) — sending the request is what confirms
 * staff have the order in hand as actually delivered.
 */
async function markDelivered(orderId) {
  return setStatusForOrder(orderId, 'Delivered');
}

module.exports = {
  listAll,
  findById,
  findAllByOrderId,
  getOrderSummary,
  listPending,
  create,
  updateStatus,
  listOutForDelivery,
  markDelivered,
};
