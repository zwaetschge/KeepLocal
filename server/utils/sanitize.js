const xss = require('xss');

const sensitiveKeys = new Set([
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'apikey'
]);

// XSS-Filteroptionen konfigurieren
const xssOptions = {
  whiteList: {
    // Erlaube nur grundlegende Formatierung
    b: [],
    i: [],
    u: [],
    br: [],
    p: [],
    strong: [],
    em: []
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style']
};

/**
 * Bereinigt einen String von potenziell schädlichem Code
 * @param {string} input - Der zu bereinigende String
 * @returns {string} - Der bereinigte String
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  return xss(input, xssOptions);
};

/**
 * Escapes user-provided input for safe use inside regular expressions
 * @param {string} input - The raw user input
 * @returns {string} - Escaped input
 */
const escapeRegex = (input) => {
  if (typeof input !== 'string') {
    return '';
  }
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Bereinigt ein ganzes Objekt rekursiv
 * @param {Object} obj - Das zu bereinigende Objekt
 * @returns {Object} - Das bereinigte Objekt
 */
const sanitizeObject = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  if (typeof obj !== 'object' || obj === null) {
    return sanitizeInput(obj);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      sanitized[key] = value;
    } else {
      sanitized[key] = sanitizeObject(value);
    }
  }
  return sanitized;
};

module.exports = {
  sanitizeInput,
  sanitizeObject,
  escapeRegex
};
