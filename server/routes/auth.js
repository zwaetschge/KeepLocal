const express = require('express');
const router = express.Router();
const passport = require('passport');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Settings = require('../models/Settings');
const {
  generateToken,
  authenticateToken,
  optionalAuth,
  setAuthCookie,
  clearAuthCookie,
  authCookieOptions
} = require('../middleware/auth');
const { clearCsrfCookie } = require('../middleware/csrfProtection');
const { publicValidationErrors } = require('../utils/validationErrors');
const { getClientURL } = require('../utils/clientUrl');

const OAUTH_STATE_COOKIE = 'kl_oauth_state';
const DUMMY_PASSWORD_HASH = '$2a$10$DOhqVvnjClITTjb5w5ae/exBwouYnqW5CmBHs1IPa3CH1LrXLpB3S';

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: publicValidationErrors(errors)
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

// GET /api/auth/registration-status - Check if registration is enabled
router.get('/registration-status', async (req, res) => {
  try {
    const userCount = await User.countDocuments();

    // If no users exist, registration is always allowed (first admin)
    if (userCount === 0) {
      return res.json({ registrationEnabled: true });
    }

    // Otherwise, check settings
    let settings = await Settings.findById('1');

    if (!settings) {
      settings = new Settings({ _id: '1', registrationEnabled: false });
      await settings.save();
    }

    res.json({ registrationEnabled: settings.registrationEnabled });
  } catch (error) {
    console.error('Error checking registration status:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen des Registrierungsstatus' });
  }
});

// POST /api/auth/register - Neuen Benutzer registrieren
router.post('/register', [
  body('username')
    .isString()
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

  body('email')
    .isString()
    .trim()
    .isEmail()
    .withMessage('Ungültige E-Mail-Adresse')
    .normalizeEmail(),

  body('password')
    .isString()
    .isLength({ min: 8, max: 128 })
    .withMessage('Passwort muss zwischen 8 und 128 Zeichen lang sein')
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
      return res.status(409).json({ error: 'Benutzername oder E-Mail-Adresse bereits vergeben' });
    }

    // Neuen Benutzer erstellen
    const user = new User({
      username,
      email,
      password,
      isAdmin: isFirstUser,
      isBootstrapAdmin: isFirstUser
    });

    await user.save();

    // Token generieren
    const token = generateToken(user._id, user.sessionVersion);
    setAuthCookie(res, token);

    res.status(201).json({
      message: 'Registrierung erfolgreich',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Benutzername oder E-Mail-Adresse bereits vergeben' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// POST /api/auth/login - Benutzer anmelden
router.post('/login', [
  body('email')
    .isString()
    .trim()
    .isEmail()
    .withMessage('Ungültige E-Mail-Adresse')
    .normalizeEmail(),

  body('password')
    .isString()
    .isLength({ min: 1, max: 128 })
    .withMessage('Passwort ist erforderlich und darf maximal 128 Zeichen lang sein'),

  handleValidationErrors
], async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Benutzer finden
    const user = await User.findOne({ email }).select('+sessionVersion');
    const isPasswordValid = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH);

    if (!user || !user.password || !isPasswordValid) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }

    // Token generieren
    const token = generateToken(user._id, user.sessionVersion);
    setAuthCookie(res, token);

    res.json({
      message: 'Anmeldung erfolgreich',
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
      provider: req.user.provider || 'local',
      avatar: req.user.avatar || null,
      createdAt: req.user.createdAt
    }
  });
});

// POST /api/auth/logout - Browser session and all copies of its JWT are revoked.
router.post('/logout', optionalAuth, async (req, res, next) => {
  try {
    if (req.user) {
      await User.updateOne(
        { _id: req.user._id, sessionVersion: req.user.sessionVersion },
        { $inc: { sessionVersion: 1 } }
      );
    }
    clearAuthCookie(res);
    clearCsrfCookie(res);
    res.json({ message: 'Erfolgreich abgemeldet' });
  } catch (error) {
    clearAuthCookie(res);
    clearCsrfCookie(res);
    next(error);
  }
});

// GET /api/auth/providers - Return which OAuth providers are configured
router.get('/providers', (req, res) => {
  res.json({
    providers: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      github: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    }
  });
});

// OAuth callback handler — generates JWT and redirects to frontend
function handleOAuthCallback(req, res) {
  const token = generateToken(req.user._id, req.user.sessionVersion);
  setAuthCookie(res, token);
  const clientURL = getClientURL(req);
  res.redirect(`${clientURL}/oauth/callback#success=1`);
}

function authenticateOAuthCallback(provider, errorCode) {
  return (req, res, next) => passport.authenticate(
    provider,
    { session: false },
    (error, user) => {
      if (error || !user) {
        return res.redirect(`${getClientURL(req)}/oauth/callback?error=${errorCode}`);
      }
      req.user = user;
      return handleOAuthCallback(req, res);
    }
  )(req, res, next);
}

function oauthStateCookieOptions(req) {
  return {
    ...authCookieOptions(null, req.secure),
    maxAge: 10 * 60 * 1000
  };
}

function issueOAuthState(req, res, next) {
  req.oauthState = crypto.randomBytes(32).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, req.oauthState, oauthStateCookieOptions(req));
  next();
}

function validateOAuthState(req, res, next) {
  const expected = req.cookies?.[OAUTH_STATE_COOKIE];
  const actual = req.query.state;
  const clearOptions = oauthStateCookieOptions(req);
  delete clearOptions.maxAge;
  res.clearCookie(OAUTH_STATE_COOKIE, clearOptions);

  if (
    typeof expected !== 'string' ||
    typeof actual !== 'string' ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))
  ) {
    return res.redirect(`${getClientURL(req)}/oauth/callback?error=invalid_oauth_state`);
  }

  return next();
}

// --- Google OAuth ---
router.get('/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(404).json({ error: 'Google OAuth is not configured' });
    }
    next();
  },
  issueOAuthState,
  (req, res, next) => passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    state: req.oauthState
  })(req, res, next)
);

router.get('/google/callback',
  validateOAuthState,
  authenticateOAuthCallback('google', 'google_auth_failed')
);

// --- GitHub OAuth ---
router.get('/github',
  (req, res, next) => {
    if (!process.env.GITHUB_CLIENT_ID) {
      return res.status(404).json({ error: 'GitHub OAuth is not configured' });
    }
    next();
  },
  issueOAuthState,
  (req, res, next) => passport.authenticate('github', {
    scope: ['user:email'],
    session: false,
    state: req.oauthState
  })(req, res, next)
);

router.get('/github/callback',
  validateOAuthState,
  authenticateOAuthCallback('github', 'github_auth_failed')
);

module.exports = router;
