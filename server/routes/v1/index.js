/**
 * API v1 Router
 * Mounts all v1 sub-routes with API key authentication
 */

const express = require('express');
const router = express.Router();
const { authenticateApiKey } = require('../../middleware/apiKeyAuth');

// All v1 routes require API key authentication
router.use(authenticateApiKey);

// Mount sub-routes
router.use('/notes', require('./notes'));
router.use('/tags', require('./tags'));
router.use('/user', require('./user'));

module.exports = router;
