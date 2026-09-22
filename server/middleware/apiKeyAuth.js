const ApiKey = require('../models/ApiKey');
const User = require('../models/User');

/**
 * Authenticate requests via API key (X-API-Key header)
 * Used for the external /api/v1/ endpoints
 */
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API-Key erforderlich. Sende den Key im X-API-Key Header.'
      });
    }

    // Look up the hashed key
    const keyDoc = await ApiKey.findByKey(apiKey);

    if (!keyDoc) {
      return res.status(401).json({
        success: false,
        error: 'Ungültiger API-Key'
      });
    }

    // Check expiration
    if (keyDoc.expiresAt && keyDoc.expiresAt < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'API-Key abgelaufen'
      });
    }

    // Load user
    const user = await User.findById(keyDoc.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Benutzer nicht gefunden'
      });
    }

    // Update last used timestamp (fire and forget)
    ApiKey.updateOne({ _id: keyDoc._id }, { lastUsedAt: new Date() })
      .exec()
      .catch(error => console.error('Failed to update API key usage timestamp:', error.message));

    req.user = user;
    req.apiKey = keyDoc;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Write guard for v1 API keys (v1.14.0). A key with explicit scopes needs
 * 'write' for mutating routes; keys without a scopes field predate the feature
 * and keep full access. Reads are never gated (a read-only key stays useful).
 */
const requireApiKeyWrite = (req, res, next) => {
  const scopes = req.apiKey?.scopes;
  if (Array.isArray(scopes) && !scopes.includes('write')) {
    return res.status(403).json({
      success: false,
      error: 'API-Key ist schreibgeschützt (nur scope: read)'
    });
  }
  next();
};

/**
 * Dual auth für /uploads (v1.15.0): Der Browser kommt mit Session-Cookie
 * (kl_session → authenticateToken), Skripte mit X-API-Key. Bis jetzt konnte ein
 * v1-Client Anhänge hochladen (ab sofort, siehe v1-Upload-Routen), aber die
 * Datei-URL nicht abrufen — GET /uploads/<name> kannte nur die Session.
 * Reihenfolge: X-API-Key gewinnt, wenn beide present sind (explizit vor
 * implizit; Browser senden den Header nie). Ohne beides: 401 mit Hinweis auf
 * beide Wege.
 *
 * ./auth wird LAZY geladen: Das Modul validiert JWT_SECRET beim require und
 * wirft dann. apiKeyAuth allein (Key-Gate der v1-API) braucht die Session-
 * Mechanik nicht — ein top-level-require machte jedes Test-Bundle, das die
 * echte Middleware lädt, von einem gesetzten JWT_SECRET abhängig (CI-Fail
 * nach v1.15.0, lokal grün, weil die Shell ihn exportiert hatte). Der
 * require.cache-Eintrag der Tests greift auch hier: Wer auth mockt, seeded
 * den Cache VOR dem ersten Aufruf.
 */
const authenticateSessionOrApiKey = (req, res, next) => {
  const { authenticateToken, AUTH_COOKIE_NAME } = require('./auth');
  if (req.headers['x-api-key']) {
    return authenticateApiKey(req, res, next);
  }
  if (req.cookies?.[AUTH_COOKIE_NAME]) {
    return authenticateToken(req, res, next);
  }
  return res.status(401).json({
    success: false,
    error: 'Authentifizierung erforderlich (Session-Cookie oder X-API-Key Header)'
  });
};

module.exports = { authenticateApiKey, requireApiKeyWrite, authenticateSessionOrApiKey };
