const config = require('../config');

/**
 * Normalizes a locally-typed phone number into E.164-ish digits-only form
 * (country code + number, no "+", no spaces) — the format wa.me needs.
 * Staff will type numbers like "17123456", "+975 17123456" or "97517123456" —
 * this handles all three without making them think about it.
 */
function normalizePhone(input) {
  const digitsOnly = String(input).replace(/\D/g, '');
  const cc = config.countryCallingCode;

  if (digitsOnly.startsWith(cc)) return digitsOnly;
  return `${cc}${digitsOnly}`;
}

/** Basic sanity check so a typo doesn't silently produce a broken wa.me link. */
function isPlausiblePhone(input) {
  const digitsOnly = String(input).replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

/** Display form, e.g. "+975 17123456" — used in confirmation messages. */
function formatForDisplay(input) {
  const normalized = normalizePhone(input);
  const cc = config.countryCallingCode;
  return `+${cc} ${normalized.slice(cc.length)}`;
}

module.exports = { normalizePhone, isPlausiblePhone, formatForDisplay };
