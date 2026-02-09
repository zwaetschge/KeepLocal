/**
 * API v1 - Tags Routes
 * External REST API for tag operations
 */

const express = require('express');
const router = express.Router();
const Note = require('../../models/Note');

/**
 * @swagger
 * /api/v1/tags:
 *   get:
 *     summary: Alle Tags des Benutzers abrufen
 *     description: Gibt eine sortierte Liste aller Tags zurück, die der Benutzer in seinen Notizen verwendet, inklusive Anzahl.
 *     tags: [Tags]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Liste der Tags mit Anzahl
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tag:
 *                         type: string
 *                         example: "arbeit"
 *                       count:
 *                         type: integer
 *                         example: 5
 *             example:
 *               success: true
 *               data:
 *                 - tag: "arbeit"
 *                   count: 12
 *                 - tag: "privat"
 *                   count: 8
 *                 - tag: "einkauf"
 *                   count: 3
 */
router.get('/', async (req, res, next) => {
  try {
    const tags = await Note.aggregate([
      {
        $match: {
          $or: [
            { userId: req.user._id },
            { sharedWith: req.user._id }
          ]
        }
      },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
