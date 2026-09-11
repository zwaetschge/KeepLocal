// One canonical email form for every path that stores or looks up an email.
// Login and register already validate with express-validator's normalizeEmail()
// chain (lowercase, gmail dot removal, subaddress removal, googlemail->gmail).
// Admin user creation and OAuth linking previously stored only
// trim().toLowerCase(), which made admin-created Gmail accounts permanently
// unloggable (no input form matches the stored dotted form) and made OAuth
// miss existing local accounts (BUG_REPORT 2026-08-15, #5).
const validator = require('validator');

/**
 * Canonicalize an email address exactly like the register/login validators.
 * @param {string} email - Raw email address
 * @returns {string|undefined} Canonical form; invalid input passes through
 *   lowercased so route validation still rejects it with a proper 400.
 */
function normalizeEmailAddress(email) {
  if (typeof email !== 'string') {
    return email;
  }
  const trimmed = email.trim();
  return validator.normalizeEmail(trimmed) || trimmed.toLowerCase();
}

module.exports = normalizeEmailAddress;
