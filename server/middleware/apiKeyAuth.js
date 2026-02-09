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
    ApiKey.updateOne({ _id: keyDoc._id }, { lastUsedAt: new Date() }).exec();

    req.user = user;
    req.apiKey = keyDoc;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { authenticateApiKey };
