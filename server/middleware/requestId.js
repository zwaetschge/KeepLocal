const crypto = require('crypto');

const HEADER = 'x-request-id';
const MAX_INCOMING_LENGTH = 128;

/**
 * Attach a request id so one user action can be followed through the server log
 * and the AI service. An incoming id (from a reverse proxy) is reused when it
 * looks sane, otherwise a fresh one is generated; the id is always echoed back.
 */
function requestId(req, res, next) {
  const incoming = req.headers[HEADER];
  const provided = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = typeof provided === 'string'
    && provided.length > 0
    && provided.length <= MAX_INCOMING_LENGTH
    && /^[\w.-]+$/.test(provided)
    ? provided
    : crypto.randomBytes(8).toString('hex');

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
module.exports.HEADER = HEADER;
