const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { generateToken, authenticateToken } = require('../middleware/auth');

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: errors.array()
    });
  }
  next();
};

// GET /api/auth/setup-needed - Check if initial setup is required
router.get('/setup-needed', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    res.json({
      setupNeeded: userCount === 0,
      message: userCount === 0 ? 'Initial setup required' : 'System already configured'
    });
  } catch (error) {
    console.error('Error checking setup status:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen des Setup-Status' });
  }
});

// POST /api/auth/register - Neuen Benutzer registrieren
router.post('/register', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Ungültige E-Mail-Adresse')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten'),

  handleValidationErrors
], async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    // Check if this is the first user (admin)
    const userCount = await User.countDocuments();
    const isFirstUser = userCount === 0;

    // If not first user, check if registration is enabled
    if (!isFirstUser) {
      let settings = await Settings.findById('1');

      // Create default settings if they don't exist
      if (!settings) {
        settings = new Settings({ _id: '1', registrationEnabled: false });
        await settings.save();
      }

      if (!settings.registrationEnabled) {
        return res.status(403).json({
          error: 'Registrierung ist derzeit deaktiviert. Bitte kontaktieren Sie einen Administrator.'
        });
      }
    }

    // Prüfen ob Benutzer bereits existiert
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(409).json({ error: 'E-Mail-Adresse bereits registriert' });
      }
      if (existingUser.username === username) {
        return res.status(409).json({ error: 'Benutzername bereits vergeben' });
      }
    }

    // Neuen Benutzer erstellen
    const user = new User({
      username,
      email,
      password,
      isAdmin: isFirstUser
    });

    await user.save();

    // Token generieren
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Registrierung erfolgreich',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// POST /api/auth/login - Benutzer anmelden
router.post('/login', [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Ungültige E-Mail-Adresse')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Passwort ist erforderlich'),

  handleValidationErrors
], async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Benutzer finden
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    // Passwort prüfen
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    // Token generieren
    const token = generateToken(user._id);

    res.json({
      message: 'Anmeldung erfolgreich',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me - Aktuellen Benutzer abrufen
router.get('/me', authenticateToken, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      isAdmin: req.user.isAdmin,
      createdAt: req.user.createdAt
    }
  });
});

// POST /api/auth/logout - Benutzer abmelden (Client muss Token löschen)
router.post('/logout', (req, res) => {
  // Bei Token-basierter Auth muss Client das Token löschen
  res.json({ message: 'Erfolgreich abgemeldet' });
});

module.exports = router;
