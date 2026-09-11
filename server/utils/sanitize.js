const sensitiveKeys = new Set([
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'apikey'
]);

// Note: request bodies, queries and params are intentionally NOT HTML-filtered
// here anymore. The previous xss() filter silently truncated plain-text note
// content ("Preis < 100" was stored as "Preis ") because stripIgnoreTag treats
// everything after "<" as tag markup. All client render paths sanitize with
// DOMPurify or render through React text nodes, and API consumers receive plain
// text they must escape themselves — the standard REST contract.

/**
 * Escapes user-provided input for safe use inside regular expressions
 * @param {string} input - The raw user input
 * @returns {string} - The escaped input
 */
const escapeRegex = (input) => {
  if (typeof input !== 'string') {
    return '';
  }
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = {
  sensitiveKeys,
  escapeRegex
};
