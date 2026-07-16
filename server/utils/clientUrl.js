const DEFAULT_CLIENT_URL = 'http://localhost:3000';
const privateDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$/;

function parseHttpOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin;
    }
  } catch (_) {
    // Invalid or missing URLs are handled by the caller's fallback.
  }
  return null;
}

function getClientURL(req, env = process.env) {
  const configured = parseHttpOrigin(env.CLIENT_URL);
  if (configured) return configured;

  const allowedOrigins = String(env.ALLOWED_ORIGINS || DEFAULT_CLIENT_URL)
    .split(',')
    .map(parseHttpOrigin)
    .filter(Boolean);

  const protocol = String(req.headers?.['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim() === 'https' ? 'https' : 'http';
  const host = String(req.headers?.host || '')
    .split(',')[0]
    .trim();
  const requestOrigin = parseHttpOrigin(`${protocol}://${host}`);

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }
  if (env.NODE_ENV !== 'production' && requestOrigin && privateDevelopmentOrigin.test(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins[0] || DEFAULT_CLIENT_URL;
}

module.exports = { getClientURL, parseHttpOrigin };
