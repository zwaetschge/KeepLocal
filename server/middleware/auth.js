const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT Secret aus Umgebungsvariablen - REQUIRED
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Security: Validate JWT_SECRET on startup
if (!JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is not set.');
  console.error('Please set a secure JWT_SECRET with at least 32 characters.');
  console.error('Generate one with: openssl rand -base64 32');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('FATAL ERROR: JWT_SECRET must be at least 32 characters long.');
  console.error('Current length:', JWT_SECRET.length);
  console.error('Generate a secure secret with: openssl rand -base64 32');
  process.exit(1);
}

// Prevent use of known weak/default secrets
const KNOWN_WEAK_SECRETS = [
  'your-secret-key-change-in-production',
  'change-this-to-a-very-long-random-secret-key-minimum-32-characters',
  'change-this-to-a-random-secret-key',
  'secret',
  'your-secret-key',
  'jwt-secret',
  'keeplocal-secret',
];

if (KNOWN_WEAK_SECRETS.includes(JWT_SECRET)) {
  console.error('FATAL ERROR: Detected use of a known weak/default JWT_SECRET.');
  console.error('This is a serious security vulnerability.');
  console.error('Generate a secure secret with: openssl rand -base64 32');
  process.exit(1);
}

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
