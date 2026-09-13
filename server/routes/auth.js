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
const { hashPasswordResetToken } = require('../utils/passwordReset');
const { publicValidationErrors } = require('../utils/validationErrors');
const { getClientURL } = require('../utils/clientUrl');
const { escapeRegex } = require('../utils/sanitize');
const {
  isDemoMode,
  blockDemoUser,
  shouldRevokeAllSessionsOnLogout
} = require('../middleware/demoPolicy');

const OAUTH_STATE_COOKIE = 'kl_oauth_state';
const DUMMY_PASSWORD_HASH = '$2a$10$DOhqVvnjClITTjb5w5ae/exBwouYnqW5CmBHs1IPa3CH1LrXLpB3S';

/**
 * Password strength rules, identical to the registration rules so resetting a
 * password cannot weaken an account.
 * @param {string} field - body field that carries the new password
 */
function passwordRules(field) {
  return [
    body(field)
      .isString()
      .isLength({ min: 8, max: 128 })
      .withMessage('Passwort muss zwischen 8 und 128 Zeichen lang sein')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten')
  ];
}

function publicAuthUser(user, includeProfile = false) {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    isAdmin: user.isAdmin,
    isDemo: user.isDemo === true,
    // Klein und unkritisch, dafür braucht die UI keine zweite Anfrage:
    // Theme, Sprache und AI-Flags folgen dem Konto statt dem Gerät.
    preferences: {
      theme: user.preferences?.theme || 'light',
      language: user.preferences?.language || null,
      aiFeatures: {
        voiceTranscription: user.preferences?.aiFeatures?.voiceTranscription === true
      },
      transcriptionLanguage: user.preferences?.transcriptionLanguage || 'auto'
    }
  };

  if (includeProfile) {
    payload.provider = user.provider || 'local';
    payload.avatar = user.avatar || null;
    payload.createdAt = user.createdAt;
  }

  return payload;
}

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
    if (isDemoMode()) {
      return res.json({
        setupNeeded: false,
        message: 'System already configured'
      });
    }

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
    if (isDemoMode()) {
      return res.json({ registrationEnabled: false });
    }

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
    if (isDemoMode()) {
      return res.status(403).json({
        error: 'Registrierung ist in der oeffentlichen Demo deaktiviert.'
      });
    }

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

    // Prüfen ob Benutzer bereits existiert. Der unique Index auf username ist
    // case-sensitive, die Freundessuche aber nicht — ohne den zusätzlichen
    // Vergleich könnte "ALICE" neben "alice" existieren und beide Accounts
    // wären in Suche und Freundschaftslisten nicht mehr unterscheidbar.
    const existingUser = await User.findOne({
      $or: [
        { email },
        { username },
        { username: { $regex: new RegExp(`^${escapeRegex(username)}$`, 'i') } }
      ]
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
      user: publicAuthUser(user)
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
      user: publicAuthUser(user)
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/change-password - eigenes Passwort ändern (angemeldet).
// Erhöht sessionVersion, damit alle anderen Sitzungen ungültig werden; die
// aktuelle Sitzung bekommt sofort ein Cookie mit der neuen Version.
router.post('/change-password', authenticateToken, blockDemoUser('password'), [
  body('currentPassword')
    .isString()
    .isLength({ min: 1, max: 128 })
    .withMessage('Aktuelles Passwort ist erforderlich'),
  ...passwordRules('newPassword'),
  handleValidationErrors
], async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('+password +sessionVersion');
    if (!user) {
      return res.status(404).json({ code: 'USER_NOT_FOUND', error: 'Benutzer nicht gefunden' });
    }
    if (!user.password) {
      return res.status(400).json({
        code: 'PASSWORD_NOT_SET',
        error: 'Dieses Konto wird per OAuth angemeldet und hat kein lokales Passwort.'
      });
    }

    const currentIsValid = await bcrypt.compare(req.body.currentPassword, user.password);
    if (!currentIsValid) {
      return res.status(401).json({ code: 'CURRENT_PASSWORD_INVALID', error: 'Aktuelles Passwort ist falsch' });
    }
    if (await bcrypt.compare(req.body.newPassword, user.password)) {
      return res.status(400).json({
        code: 'PASSWORD_UNCHANGED',
        error: 'Das neue Passwort muss sich vom bisherigen unterscheiden'
      });
    }

    user.password = req.body.newPassword; // pre-save hook hashes
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();

    const token = generateToken(user._id, user.sessionVersion);
    setAuthCookie(res, token);

    res.json({ message: 'Passwort geändert', user: publicAuthUser(user) });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/reset-password - Einmal-Token einlösen (ohne gültige Sitzung).
// Das Token erzeugt ein Administrator unter /api/admin/users/:id/password-reset;
// gespeichert wird nur der SHA-256-Hash, gültig ist es 15 Minuten.
router.post('/reset-password', [
  body('token')
    .isString()
    .isLength({ min: 16, max: 200 })
    .withMessage('Ungültiger Reset-Token'),
  ...passwordRules('newPassword'),
  handleValidationErrors
], async (req, res, next) => {
  try {
    const user = await User.findOne({
      passwordResetToken: hashPasswordResetToken(req.body.token),
      passwordResetExpires: { $gt: new Date() }
    }).select('+password +sessionVersion +passwordResetToken +passwordResetExpires');

    if (!user) {
      // Generische Antwort: nicht verraten, ob es Konto oder Token gibt.
      return res.status(400).json({
        code: 'RESET_TOKEN_INVALID',
        error: 'Reset-Token ist ungültig oder abgelaufen'
      });
    }

    user.password = req.body.newPassword;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    // Alle bestehenden Sitzungen verlieren ihre Gültigkeit.
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    await user.save();

    res.json({ message: 'Passwort zurückgesetzt. Bitte melde dich neu an.' });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/demo - Start a session for the deliberately restricted
// public demo account. There is no shared public password to leak or reuse.
router.post('/demo', async (req, res, next) => {
  try {
    if (!isDemoMode()) {
      return res.status(404).json({ error: 'Demo ist nicht aktiviert' });
    }

    const user = await User.findOne({ isDemo: true, isAdmin: false, provider: 'local' })
      .select('+sessionVersion');

    if (!user) {
      return res.status(503).json({
        error: 'Demo wird gerade vorbereitet. Bitte versuche es gleich erneut.',
        code: 'DEMO_NOT_READY'
      });
    }

    const token = generateToken(user._id, user.sessionVersion);
    setAuthCookie(res, token);

    return res.json({
      message: 'Demo gestartet',
      user: publicAuthUser(user)
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/auth/me - Aktuellen Benutzer abrufen
router.get('/me', authenticateToken, async (req, res) => {
  res.json({
    user: publicAuthUser(req.user, true)
  });
});

// PUT /api/auth/preferences - Konto-weite Voreinstellungen speichern.
// Nur whitelist-Felder werden übernommen; unbekannte Schlüssel fallen weg, damit
// ein Client nicht beliebige Dokumentteile schreiben kann.
router.put('/preferences', authenticateToken, blockDemoUser('preferences'), async (req, res, next) => {
  try {
    const { theme, language, aiFeatures, transcriptionLanguage } = req.body || {};
    const update = {};

    if (theme !== undefined) {
      if (!['light', 'dark', 'oled', 'eink', 'doodle'].includes(theme)) {
        return res.status(400).json({ error: 'Ungueltiges Theme' });
      }
      update['preferences.theme'] = theme;
    }
    if (language !== undefined) {
      if (language !== null && !['de', 'en'].includes(language)) {
        return res.status(400).json({ error: 'Ungueltige Sprache' });
      }
      update['preferences.language'] = language;
    }
    if (aiFeatures !== undefined) {
      if (typeof aiFeatures !== 'object' || aiFeatures === null || Array.isArray(aiFeatures)) {
        return res.status(400).json({ error: 'Ungueltige AI-Einstellungen' });
      }
      if (aiFeatures.voiceTranscription !== undefined) {
        if (typeof aiFeatures.voiceTranscription !== 'boolean') {
          return res.status(400).json({ error: 'voiceTranscription muss ein Boolean sein' });
        }
        update['preferences.aiFeatures.voiceTranscription'] = aiFeatures.voiceTranscription;
      }
    }
    if (transcriptionLanguage !== undefined) {
      if (
        typeof transcriptionLanguage !== 'string'
        || transcriptionLanguage.length > 20
        || (transcriptionLanguage !== 'auto' && !/^[a-z]{2}(-[A-Z]{2})?$/.test(transcriptionLanguage))
      ) {
        return res.status(400).json({ error: 'Ungueltige Transkriptionssprache' });
      }
      update['preferences.transcriptionLanguage'] = transcriptionLanguage;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Keine gueltigen Einstellungen uebermittelt' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    res.json({ message: 'Einstellungen gespeichert', preferences: publicAuthUser(user).preferences });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout - Normal accounts revoke every copy of the current
// session. The shared demo only clears this browser so one visitor cannot log
// out everybody else.
router.post('/logout', optionalAuth, async (req, res, next) => {
  try {
    if (shouldRevokeAllSessionsOnLogout(req.user)) {
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
  const demo = isDemoMode();
  res.json({
    providers: {
      google: !demo && !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      github: !demo && !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      demo
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
        // "Verify your email at the provider" is actionable, a generic
        // "auth failed" is not — carry the specific code through.
        const code = error?.code === 'oauth_email_unverified' ? 'oauth_email_unverified' : errorCode;
        return res.redirect(`${getClientURL(req)}/oauth/callback?error=${code}`);
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

function rejectOAuthInDemo(req, res, next) {
  if (isDemoMode()) {
    return res.status(404).json({ error: 'OAuth ist in der Demo nicht konfiguriert' });
  }
  return next();
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
    if (isDemoMode() || !process.env.GOOGLE_CLIENT_ID) {
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
  rejectOAuthInDemo,
  validateOAuthState,
  authenticateOAuthCallback('google', 'google_auth_failed')
);

// --- GitHub OAuth ---
router.get('/github',
  (req, res, next) => {
    if (isDemoMode() || !process.env.GITHUB_CLIENT_ID) {
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
  rejectOAuthInDemo,
  validateOAuthState,
  authenticateOAuthCallback('github', 'github_auth_failed')
);

module.exports = router;
