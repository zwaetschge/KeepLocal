const xss = require('xss');

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
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeInput(obj);
  }

  const sanitized = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      if (typeof obj[key] === 'string') {
        sanitized[key] = sanitizeInput(obj[key]);
      } else if (Array.isArray(obj[key])) {
        sanitized[key] = obj[key].map(item =>
          typeof item === 'string' ? sanitizeInput(item) : item
        );
      } else if (typeof obj[key] === 'object') {
        sanitized[key] = sanitizeObject(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }
  }
  return sanitized;
};

module.exports = {
  sanitizeInput,
  sanitizeObject,
  escapeRegex
};
