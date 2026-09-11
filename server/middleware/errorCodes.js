const { codeForMessage } = require('../constants/errorCodes');

/**
 * Adds a stable `code` to every JSON error response that carries an `error`
 * string but no explicit code yet.
 *
 * Mounted once in front of the routers, so the ~80 route-level
 * `res.status(x).json({ error: '…' })` calls all gain a machine-readable code
 * without being touched — while an explicit code at the call site always wins.
 * Clients translate via the code and keep the prose as a fallback, which is how
 * a German-only API stops leaking German text into an English UI.
 */
function errorCodeMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function jsonWithErrorCode(body) {
    if (
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && typeof body.error === 'string'
      && body.code === undefined
      && res.statusCode >= 400
    ) {
      body.code = codeForMessage(body.error, res.statusCode);
    }
    return originalJson(body);
  };

  next();
}

module.exports = errorCodeMiddleware;
