const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT Secret aus Umgebungsvariablen - zwingend erforderlich und ausreichend lang
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET environment variable must be set and at least 32 characters long');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Token generieren
const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// Token verifizieren und Benutzer laden
const authenticateToken = async (req, res, next) => {
  try {
    // Token aus Authorization-Header oder Cookie extrahieren
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : req.cookies?.token;

    if (!token) {
      return res.status(401).json({ error: 'Authentifizierung erforderlich' });
    }

    // Token verifizieren
    const decoded = jwt.verify(token, JWT_SECRET);

    // Benutzer aus Datenbank laden
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'Benutzer nicht gefunden' });
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
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : req.cookies?.token;

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user) {
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
  JWT_SECRET,
  JWT_EXPIRES_IN
};
