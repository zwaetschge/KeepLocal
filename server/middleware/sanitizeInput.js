const { sanitizeObject } = require('../utils/sanitize');

/**
 * Middleware zum Bereinigen aller Eingaben im Request-Body
 */
const sanitizeInputMiddleware = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.params) {
    for (const key in req.params) {
      if (typeof req.params[key] === 'string') {
        // ObjectIDs und ähnliche Params nicht sanitizen
        if (!key.includes('id') && !key.includes('Id')) {
          const { sanitizeInput } = require('../utils/sanitize');
          req.params[key] = sanitizeInput(req.params[key]);
        }
      }
    }
  }

  if (req.query) {
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        const { sanitizeInput } = require('../utils/sanitize');
        req.query[key] = sanitizeInput(req.query[key]);
      }
    }
  }

  next();
};

module.exports = sanitizeInputMiddleware;
