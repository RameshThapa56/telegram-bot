// Post-delivery customer feedback: a pre-filled Google Form link (Order ID
// baked in, so the customer never sees or types it) plus a one-tap wa.me
// link that hands it to the customer — the exact same free wa.me pattern
// already used for invoices/delivery notices (see utils/links.js), just with
// a feedback message instead. Responses land in the Sheet linked to the Form
// automatically (native Google Forms behavior) — no custom storage needed.

const config = require('../config');
const { buildWhatsAppLink } = require('./links');

/**
 * Builds a Google Form pre-fill URL with the Order ID already dropped into
 * its field. Requires a one-time Form setup (see .env.example):
 *   1. FEEDBACK_FORM_BASE_URL — the form's public "viewform" URL.
 *   2. FEEDBACK_FORM_ORDER_ID_ENTRY — the "entry.XXXXXXXXX" field id for the
 *      Order ID question (Form → ⋮ → Get pre-filled link).
 * Rating (1-5) and Comments (optional) are left blank for the customer to
 * fill in themselves — only Order ID is pre-filled/hidden from them.
 */
function buildFeedbackFormLink(orderId) {
  if (!config.feedbackFormBaseUrl || !config.feedbackFormOrderIdEntry) {
    throw new Error(
      'Feedback form is not configured — set FEEDBACK_FORM_BASE_URL and FEEDBACK_FORM_ORDER_ID_ENTRY (see .env.example).'
    );
  }
  const url = new URL(config.feedbackFormBaseUrl);
  url.searchParams.set(config.feedbackFormOrderIdEntry, orderId);
  // usp=pp_url tells Forms this is a pre-filled link (cosmetic — Forms sets
  // it itself on generated links; harmless either way if omitted).
  url.searchParams.set('usp', 'pp_url');
  return url.toString();
}

/**
 * Builds the one-tap wa.me link staff send once an order is marked
 * Delivered. Reuses buildWhatsAppLink() from utils/links.js — same helper
 * the invoice/delivery-notice flows use — so normalization, encoding, and
 * the wa.me URL shape all stay identical across every customer-facing link.
 */
function buildFeedbackWhatsAppLink(customerPhone, orderId, customerName) {
  const formLink = buildFeedbackFormLink(orderId);
  const message =
    `Hi ${customerName}, this is ${config.businessName}! 👟\n\n` +
    `Your order ${orderId} has been delivered — thank you for shopping with us!\n\n` +
    `We'd love to hear how it went — got a minute?\n${formLink}\n\n` +
    `Thank you! 🙏`;
  return buildWhatsAppLink(customerPhone, message);
}

module.exports = { buildFeedbackFormLink, buildFeedbackWhatsAppLink };
