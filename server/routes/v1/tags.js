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
 *     description: Gibt eine sortierte Liste aller Tags zurück, die der Benutzer in seinen Notizen verwendet, inklusive Anzahl. Zählt standardmäßig nur aktive (nicht archivierte) Notizen — konsistent mit der Notizliste; mit ?archived=true werden archivierte Notizen gezählt.
 *     tags: [Tags]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: archived
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Zählt mit archived=true die Tags archivierter Notizen (Standard ist false)
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
    // Match the browser tag list, which counts only the active (or only the
    // archived) view — otherwise API counts disagree with the app. Trashed notes
    // count for neither: `GET /api/v1/notes` does not return them, so their tags
    // and counts must not show up here.
    const isArchived = req.query.archived === 'true';
    const tags = await Note.aggregate([
      {
        $match: {
          $or: [
            { userId: req.user._id },
            { sharedWith: req.user._id }
          ],
          isArchived,
          deletedAt: null
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
