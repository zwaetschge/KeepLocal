const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT Secret aus Umgebungsvariablen - zwingend erforderlich und ausreichend lang
const JWT_SECRET = process.env.JWT_SECRET;

if (
  !JWT_SECRET ||
  JWT_SECRET.length < 32 ||
  /(?:change[-_ ]?this|your[-_ ]?jwt|example[-_ ]?secret)/i.test(JWT_SECRET)
) {
  throw new Error('JWT_SECRET environment variable must be set and at least 32 characters long');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const AUTH_COOKIE_NAME = 'kl_session';
const LEGACY_AUTH_COOKIE_NAME = 'token';

const cookieIsSecure = (requestIsSecure = false) => {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return Boolean(requestIsSecure);
};

const authCookieOptions = (token, requestIsSecure = false) => {
  const options = {
    httpOnly: true,
    secure: cookieIsSecure(requestIsSecure),
    sameSite: 'lax',
    path: '/',
    priority: 'high'
  };

  if (token) {
    const decoded = jwt.decode(token);
    if (decoded?.exp) {
      options.expires = new Date(decoded.exp * 1000);
    }
  }

  return options;
};

// Token generieren
const generateToken = (userId, sessionVersion = 0) => {
  return jwt.sign({ userId, sessionVersion }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

const setAuthCookie = (res, token) => {
  res.clearCookie(LEGACY_AUTH_COOKIE_NAME, authCookieOptions(null, res.req?.secure));
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(token, res.req?.secure));
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions(null, res.req?.secure));
  res.clearCookie(LEGACY_AUTH_COOKIE_NAME, authCookieOptions(null, res.req?.secure));
};

// Token verifizieren und Benutzer laden
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ error: 'Authentifizierung erforderlich' });
    }

    // Token verifizieren
    const decoded = jwt.verify(token, JWT_SECRET);

    // Benutzer aus Datenbank laden
    const user = await User.findById(decoded.userId).select('-password +sessionVersion');

    if (
      !user ||
      !Number.isInteger(decoded.sessionVersion) ||
      decoded.sessionVersion !== user.sessionVersion
    ) {
      return res.status(401).json({ error: 'Sitzung ist nicht mehr gueltig' });
    }

    // Benutzer an Request anhängen
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Ungültiges Token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token abgelaufen' });
    }
    next(error);
  }
};

// Optionale Authentifizierung (kein Fehler wenn kein Token)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password +sessionVersion');
      if (
        user &&
        Number.isInteger(decoded.sessionVersion) &&
        decoded.sessionVersion === user.sessionVersion
      ) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // Fehler ignorieren, Benutzer bleibt einfach unauthentifiziert
    next();
  }
};

module.exports = {
  generateToken,
  authenticateToken,
  optionalAuth,
  setAuthCookie,
  clearAuthCookie,
  authCookieOptions,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  AUTH_COOKIE_NAME
};
