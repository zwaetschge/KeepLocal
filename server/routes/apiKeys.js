/**
 * API Key Management Routes
 * Allows users to create, list, and revoke API keys for external API access
 * These routes use the authenticated browser cookie to manage keys.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ApiKey = require('../models/ApiKey');
const { authenticateToken } = require('../middleware/auth');

// All routes require JWT authentication
router.use(authenticateToken);

/**
 * @swagger
 * /api/api-keys:
 *   get:
 *     summary: List all API keys for the current user
 *     tags: [API Keys]
 *     security:
 *     responses:
 *       200:
 *         description: List of API keys (without the actual key values)
 */
router.get('/', async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user._id })
      .select('-key')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: keys
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/api-keys:
 *   post:
 *     summary: Create a new API key
 *     tags: [API Keys]
 *     security:
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 description: A descriptive name for the key
 *               expiresIn:
 *                 type: string
 *                 enum: [30d, 90d, 365d, never]
 *                 default: never
 *     responses:
 *       201:
 *         description: API key created. The key value is only returned once.
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, expiresIn } = req.body;

    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name muss zwischen 1 und 100 Zeichen lang sein'
      });
    }

    const expirationDays = {
      '30d': 30,
      '90d': 90,
      '365d': 365,
      never: null
    };
    const expirationKey = expiresIn || 'never';
    if (!Object.prototype.hasOwnProperty.call(expirationDays, expirationKey)) {
      return res.status(400).json({
        success: false,
        error: 'expiresIn muss 30d, 90d, 365d oder never sein'
      });
    }

    // Limit keys per user
    const existingCount = await ApiKey.countDocuments({ userId: req.user._id });
    if (existingCount >= 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximal 10 API-Keys pro Benutzer erlaubt'
      });
    }

    const { rawKey, hash, prefix } = ApiKey.generateKey();

    // Calculate expiration
    let expiresAt = null;
    const days = expirationDays[expirationKey];
    if (days) {
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const apiKey = new ApiKey({
      name: name.trim(),
      key: hash,
      prefix,
      userId: req.user._id,
      expiresAt
    });

    await apiKey.save();

    res.status(201).json({
      success: true,
      data: {
        id: apiKey._id,
        name: apiKey.name,
        key: rawKey, // Only returned once!
        prefix: apiKey.prefix,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt
      },
      message: 'API-Key erstellt. Speichere den Key sicher - er wird nur einmal angezeigt!'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/api-keys/{id}:
 *   delete:
 *     summary: Revoke (delete) an API key
 *     tags: [API Keys]
 *     security:
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API key revoked
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Ungueltige API-Key-ID'
      });
    }

    const key = await ApiKey.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!key) {
      return res.status(404).json({
        success: false,
        error: 'API-Key nicht gefunden'
      });
    }

    res.json({
      success: true,
      message: 'API-Key widerrufen'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
