const config = require('../config');
const { formatForDisplay } = require('./phone');

const money = (n) => `Nu. ${Number(n).toFixed(2)}`;

/**
 * Escapes the handful of characters legacy Telegram Markdown treats as
 * formatting (`_`, `*`, `` ` ``, `[`). Every value that came from staff
 * typing — a brand, a color, a customer name — has to go through this
 * before landing inside a bold/code template, otherwise one stray
 * underscore or asterisk can either mangle the layout or make Telegram
 * reject the whole message as unparseable.
 */
function escapeMd(text) {
  return String(text).replace(/([_*`[])/g, '\\$1');
}

/** Parses staff-typed numbers like "1200", "1,200", "1200.50" — forgiving of commas/spaces. */
function parseNumber(input) {
  const cleaned = String(input).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function orderMessage(order) {
  const itemLines = order.Items.map((it) => `${it.ItemDesc} x${it.Qty}`).join('\n');
  return (
    `Hi ${order.CustomerName}, this is ${config.businessName}! 👟\n\n` +
    `Your order is confirmed:\n` +
    `${itemLines}\n` +
    `Total: ${money(order.Total)}\n` +
    `Delivery to: ${order.DeliveryLocation}\n\n` +
    `Order ID: ${order.OrderID}\n` +
    `We'll message you again once it's out for delivery. Thank you for shopping with us! 🙏`
  );
}

/**
 * Message sent to the driver for pickup — deliberately no product name/qty
 * or delivery charge (not the driver's business); just enough to find the
 * right order and reach the customer. The customer's phone is formatted
 * with the country code (e.g. "+975 17123456") so WhatsApp auto-links it
 * into a tap-to-call number.
 */
function driverMessage(delivery, order) {
  return (
    `Hi, this is ${config.businessName}.\n\n` +
    `Please pick up this delivery:\n` +
    `Order ID: ${order.OrderID}\n` +
    `Drop-off: ${order.DeliveryLocation}\n` +
    `Customer: ${order.CustomerName}\n` +
    `Phone: ${formatForDisplay(order.CustomerPhone)}\n\n` +
    `Thank you for helping us deliver! 🙏`
  );
}

/**
 * Itemized invoice for the customer — product, qty, price, total, delivery
 * details. Built from the same Order + Delivery data already on hand when a
 * delivery is logged, so there's no separate "Invoices" sheet to keep in
 * sync; the invoice is just a formatted view of those two records.
 */
function invoiceMessage(order, delivery) {
  const itemLines = order.Items.map((it) => `${it.ItemDesc}\n${it.Qty} x ${money(it.Price)} = ${money(it.Total)}`).join(
    '\n\n'
  );
  return (
    `🧾 *${config.businessName} — Invoice*\n` +
    `─────────────────\n` +
    `Order ID: ${order.OrderID}\n` +
    `Date: ${new Date(order.Timestamp).toLocaleDateString()}\n\n` +
    `*Bill To*\n` +
    `${order.CustomerName}\n` +
    `${formatForDisplay(order.CustomerPhone)}\n\n` +
    `*Items*\n` +
    `${itemLines}\n\n` +
    `*Total: ${money(order.Total)}*\n\n` +
    `*Payment*\n` +
    `${order.PaymentMethod === 'Bank Transfer' ? `${order.BankName} • Journal #${order.JournalNumber}` : order.PaymentMethod}\n\n` +
    `*Delivery*\n` +
    `${delivery.method}${delivery.vehiclePlate ? ` (${delivery.vehiclePlate})` : ''} → ${order.DeliveryLocation}\n\n` +
    `Thank you for shopping with us! 🙏`
  );
}

/**
 * Message sent to the customer once their order is out for delivery. Pickup
 * Address is the same DeliveryLocation recorded on the order — for a Bus
 * delivery that's where the customer actually goes to collect it, not a
 * separate address. Driver phone is formatted with the country code (e.g.
 * "+975 17123456") so WhatsApp auto-links it to tap-to-call.
 */
function customerDeliveryMessage(delivery, order) {
  return (
    `Hi ${order.CustomerName}, your ${config.businessName} order is on the way! 🚚\n\n` +
    `Order ID: ${order.OrderID}\n` +
    `Delivery Method: ${delivery.method}\n` +
    `Driver Contact: ${formatForDisplay(delivery.driverPhone)}\n` +
    `Pickup Address: ${order.DeliveryLocation}\n` +
    `Vehicle Number: ${delivery.vehiclePlate}\n\n` +
    `Thank you for shopping with us! Looking forward to serving you again. 🙏`
  );
}

module.exports = {
  money,
  parseNumber,
  escapeMd,
  orderMessage,
  driverMessage,
  customerDeliveryMessage,
  invoiceMessage,
};
