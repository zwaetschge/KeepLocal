/**
 * API v1 - Notes Routes
 * External REST API for notes, authenticated via API key
 */

const express = require('express');
const router = express.Router();
const { notesService } = require('../../services');
const { httpStatus } = require('../../constants');

/**
 * @swagger
 * components:
 *   schemas:
 *     Note:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "507f1f77bcf86cd799439011"
 *         title:
 *           type: string
 *           example: "Einkaufsliste"
 *         content:
 *           type: string
 *           example: "Milch, Brot, Eier"
 *         color:
 *           type: string
 *           enum: ["#ffffff","#f28b82","#fbbc04","#fff475","#ccff90","#a7ffeb","#cbf0f8","#aecbfa","#d7aefb","#fdcfe8","#e6c9a8","#e8eaed"]
 *           example: "#ffffff"
 *         isPinned:
 *           type: boolean
 *         isArchived:
 *           type: boolean
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["einkauf", "wichtig"]
 *         isTodoList:
 *           type: boolean
 *         todoItems:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *               completed:
 *                 type: boolean
 *               order:
 *                 type: number
 *         images:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               filename:
 *                 type: string
 *               thumbnailUrl:
 *                 type: string
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     NoteInput:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           maxLength: 200
 *           example: "Einkaufsliste"
 *         content:
 *           type: string
 *           maxLength: 10000
 *           example: "Milch, Brot, Eier"
 *         color:
 *           type: string
 *           enum: ["#ffffff","#f28b82","#fbbc04","#fff475","#ccff90","#a7ffeb","#cbf0f8","#aecbfa","#d7aefb","#fdcfe8","#e6c9a8","#e8eaed"]
 *         isPinned:
 *           type: boolean
 *           default: false
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *         isTodoList:
 *           type: boolean
 *           default: false
 *         todoItems:
 *           type: array
 *           items:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *               completed:
 *                 type: boolean
 *               order:
 *                 type: number
 *     ApiResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *         error:
 *           type: string
 *     PaginatedNotes:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Note'
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             total:
 *               type: integer
 *             pages:
 *               type: integer
 */

/**
 * @swagger
 * /api/v1/notes:
 *   get:
 *     summary: Alle Notizen abrufen
 *     description: Gibt alle eigenen und geteilten Notizen zurück, mit optionaler Suche, Tag-Filter und Paginierung.
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Volltextsuche in Titel und Inhalt
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *         description: Nach Tag filtern
 *       - in: query
 *         name: archived
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *           default: "false"
 *         description: Archivierte Notizen anzeigen
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Seitennummer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Einträge pro Seite
 *     responses:
 *       200:
 *         description: Liste der Notizen
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedNotes'
 *       401:
 *         description: Nicht authentifiziert
 */
router.get('/', async (req, res, next) => {
  try {
    const { search, tag, page, limit, archived } = req.query;

    const result = await notesService.getAllNotes({
      userId: req.user._id,
      search,
      tag,
      page: page || 1,
      limit: Math.min(parseInt(limit) || 50, 100),
      archived: archived || 'false'
    });

    res.json({
      success: true,
      data: result.notes,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}:
 *   get:
 *     summary: Einzelne Notiz abrufen
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Notiz-ID
 *     responses:
 *       200:
 *         description: Die Notiz
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Note'
 *       404:
 *         description: Notiz nicht gefunden
 */
router.get('/:id', async (req, res, next) => {
  try {
    const note = await notesService.getNoteById(req.params.id, req.user._id);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes:
 *   post:
 *     summary: Neue Notiz erstellen
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NoteInput'
 *           examples:
 *             textNote:
 *               summary: Einfache Textnotiz
 *               value:
 *                 title: "Meine Notiz"
 *                 content: "Inhalt der Notiz"
 *                 color: "#ffffff"
 *                 tags: ["arbeit"]
 *             todoNote:
 *               summary: Todo-Liste
 *               value:
 *                 title: "Einkaufsliste"
 *                 isTodoList: true
 *                 todoItems:
 *                   - text: "Milch"
 *                     completed: false
 *                   - text: "Brot"
 *                     completed: true
 *     responses:
 *       201:
 *         description: Notiz erstellt
 *       400:
 *         description: Ungültige Daten
 */
router.post('/', async (req, res, next) => {
  try {
    const note = await notesService.createNote(req.body, req.user._id);
    res.status(httpStatus.CREATED).json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: error.message
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}:
 *   put:
 *     summary: Notiz aktualisieren
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NoteInput'
 *     responses:
 *       200:
 *         description: Notiz aktualisiert
 *       404:
 *         description: Notiz nicht gefunden
 */
router.put('/:id', async (req, res, next) => {
  try {
    const note = await notesService.updateNote(req.params.id, req.body, req.user._id);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    if (error.statusCode === 400 || error.name === 'ValidationError') {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: error.message
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}:
 *   delete:
 *     summary: Notiz löschen
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notiz gelöscht
 *       404:
 *         description: Notiz nicht gefunden
 */
router.delete('/:id', async (req, res, next) => {
  try {
    await notesService.deleteNote(req.params.id, req.user._id);
    res.json({
      success: true,
      message: 'Notiz gelöscht'
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}/pin:
 *   post:
 *     summary: Pin-Status umschalten
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pin-Status geändert
 */
router.post('/:id/pin', async (req, res, next) => {
  try {
    const note = await notesService.togglePinNote(req.params.id, req.user._id);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}/archive:
 *   post:
 *     summary: Archiv-Status umschalten
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archiv-Status geändert
 */
router.post('/:id/archive', async (req, res, next) => {
  try {
    const note = await notesService.toggleArchiveNote(req.params.id, req.user._id);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}/share:
 *   post:
 *     summary: Notiz mit einem Benutzer teilen
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId:
 *                 type: string
 *                 description: ID des Benutzers, mit dem geteilt werden soll
 *     responses:
 *       200:
 *         description: Notiz geteilt
 */
router.post('/:id/share', async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.body;
    if (!targetUserId) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'userId ist erforderlich'
      });
    }
    const note = await notesService.shareNote(req.params.id, req.user._id, targetUserId);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz oder Benutzer nicht gefunden'
      });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}/share/{userId}:
 *   delete:
 *     summary: Notiz-Freigabe für einen Benutzer aufheben
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Freigabe aufgehoben
 */
router.delete('/:id/share/:userId', async (req, res, next) => {
  try {
    const note = await notesService.unshareNote(req.params.id, req.user._id, req.params.userId);
    res.json({
      success: true,
      data: note
    });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        error: 'Notiz nicht gefunden'
      });
    }
    next(error);
  }
});

module.exports = router;
