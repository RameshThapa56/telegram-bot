const { normalizePhone } = require('./phone');

/**
 * Builds a one-tap wa.me link. Opening it on the phone that owns the number
 * (or any phone with WhatsApp installed) opens a chat with the message
 * pre-filled — the person still has to hit Send, so this needs no WhatsApp
 * Business API approval, no per-message cost, nothing to apply for.
 */
function buildWhatsAppLink(phone, message) {
  const number = normalizePhone(phone);
  const text = encodeURIComponent(message);
  return `https://wa.me/${number}?text=${text}`;
}

/**
 * Builds an SMS deep link as a fallback for customers/drivers without WhatsApp.
 * iOS and Android disagree on the separator before "body=" (iOS wants "&",
 * older Android wants "?"), so we default to "&" (works on modern Android too)
 * and note the caveat in the README rather than trying to sniff the OS.
 */
function buildSmsLink(phone, message) {
  const number = normalizePhone(phone);
  const body = encodeURIComponent(message);
  return `sms:+${number}&body=${body}`;
}

module.exports = { buildWhatsAppLink, buildSmsLink };
