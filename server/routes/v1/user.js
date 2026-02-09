/**
 * API v1 - User Routes
 * External REST API for user profile info
 */

const express = require('express');
const router = express.Router();
const Note = require('../../models/Note');

/**
 * @swagger
 * /api/v1/user/me:
 *   get:
 *     summary: Eigenes Profil abrufen
 *     description: Gibt Informationen zum authentifizierten Benutzer zurück.
 *     tags: [User]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Benutzerinformationen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     username:
 *                       type: string
 *                     email:
 *                       type: string
 *                     isAdmin:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 */
router.get('/me', async (req, res, next) => {
  try {
    // Get note count for the user
    const noteCount = await Note.countDocuments({
      $or: [
        { userId: req.user._id },
        { sharedWith: req.user._id }
      ]
    });

    res.json({
      success: true,
      data: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        isAdmin: req.user.isAdmin,
        noteCount,
        createdAt: req.user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
