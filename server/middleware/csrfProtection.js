const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'kl_csrf';
const CSRF_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfSecret() {
  const secret = process.env.CSRF_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('CSRF_SECRET or JWT_SECRET must be at least 32 characters long');
  }
  return secret;
}

function cookieIsSecure(requestIsSecure = false) {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return Boolean(requestIsSecure);
}

function signNonce(nonce) {
  return crypto
    .createHmac('sha256', csrfSecret())
    .update(`keeplocal-csrf:${nonce}`)
    .digest('hex');
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('hex');
  return `${nonce}.${signNonce(nonce)}`;
}

function verifyCsrfToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) {
    return false;
  }

  const [nonce, signature] = token.split('.');
  const expected = signNonce(nonce);
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

function csrfCookieOptions(requestIsSecure = false) {
  return {
    httpOnly: true,
    secure: cookieIsSecure(requestIsSecure),
    sameSite: 'lax',
    path: '/',
    maxAge: CSRF_MAX_AGE_MS
  };
}

function issueCsrfToken(req, res) {
  const existing = req.cookies?.[CSRF_COOKIE_NAME];
  const token = verifyCsrfToken(existing) ? existing : createCsrfToken();
  if (token !== existing) {
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions(req.secure));
  }
  return token;
}

function clearCsrfCookie(res) {
  const options = csrfCookieOptions(res.req?.secure);
  delete options.maxAge;
  res.clearCookie(CSRF_COOKIE_NAME, options);
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (
    typeof cookieToken !== 'string' ||
    typeof headerToken !== 'string' ||
    cookieToken.length !== headerToken.length ||
    !verifyCsrfToken(cookieToken) ||
    !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    return res.status(403).json({ error: 'Ungueltiges CSRF-Token' });
  }

  return next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  createCsrfToken,
  verifyCsrfToken,
  issueCsrfToken,
  clearCsrfCookie,
  csrfProtection
};
