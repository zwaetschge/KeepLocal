/**
 * API v1 - Notes Routes
 * External REST API for notes, authenticated via API key
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const notesService = require('../../services/notesService');
const { httpStatus } = require('../../constants');
const { requireApiKeyWrite } = require('../../middleware/apiKeyAuth');
const { upload, uploadPdf, isSafeStoredFilename } = require('../../middleware/upload');
const noteValidation = require('../../middleware/validators');
const { blockDemoUser } = require('../../middleware/demoPolicy');
// Geteilte Upload-Pipeline (v1.15.0): dieselben Handler wie die Session-Route.
const {
  requireEditableNote,
  rejectIfAttachmentFull,
  wrapUpload,
  handleImageUpload,
  handleFileUpload
} = require('../../utils/attachmentUpload');
const { imagesDir, filesDir } = require('../../config/paths');

const blockDemoUploads = blockDemoUser('uploads');

/**
 * v1-Antwortformat fuer die geteilte Upload-Pipeline (v1.15.0). Die Kette
 * (validators, demoPolicy, requireEditableNote, wrapUpload, Handler) antwortet
 * im Session-Format: nackte Notiz bei Erfolg, { error } bei Ablehnung. Die
 * v1-API verspricht aber { success, data } bzw. { success, error } — der
 * Envelope entsteht hier, direkt nach dem Schreib-Schutz (dessen 403er bereits
 * success: false traegt und deshalb unangetastet bleibt), damit alle
 * Zwischenstuecke (Validierung, Demo-Sperre, Limit erreicht, Multer-Fehler,
 * Handler, spaeter der globale Fehler-Handler) dasselbe Format liefern. Nach
 * dem ersten json()-Aufruf ist die Verpackung wieder entfernt.
 */
const v1ResponseEnvelope = (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.json = originalJson;
    if (body !== null && typeof body === 'object' && body.success === undefined) {
      if (body._id !== undefined) {
        return originalJson({ success: true, data: body });
      }
      if (body.error !== undefined) {
        // Spread statt Feldkopie: Demo-Sperre (code/feature) und Validierung
        // (details) duerfen ihre Zusatzfelder nicht verlieren.
        return originalJson({ ...body, success: false });
      }
    }
    return originalJson(body);
  };
  next();
};

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
 *         order:
 *           type: integer
 *           description: Manuelle Position im Abschnitt (angeheftet/sonstige) — höher = weiter oben; 0 = nie manuell sortiert, dann entscheidet updatedAt.
 *           example: 3
 *         remindAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Erinnerungszeitpunkt; null = keine Erinnerung.
 *         parentId:
 *           type: string
 *           nullable: true
 *           description: Übergeordnete Notiz (Baum, v1.10.0); null = Wurzel-Ebene. Eine Notiz mit Kindern verhält sich wie ein Ordner.
 *         isCode:
 *           type: boolean
 *           description: Code-/Monospace-Notiz (v1.10.0) — Clients stellen Inhalt dicktengleich dar.
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
 *         order:
 *           type: integer
 *           minimum: 0
 *           description: Manuelle Position setzen (nur Update — beim Anlegen vergibt der Server selbst einen Platz an der Spitze des Abschnitts). 0 setzt auf "nie manuell sortiert" zurück.
 *         remindAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Erinnerung setzen; null löscht sie.
 *         parentId:
 *           type: string
 *           nullable: true
 *           description: Notiz unter eine andere hängen (Baum, v1.10.0); null löst die Notiz vom Baum (Wurzel-Ebene), fehlt das Feld, bleibt die Position unangetastet. Zyklen werden mit 400 abgelehnt.
 *         isCode:
 *           type: boolean
 *           description: Als Code-/Monospace-Notiz markieren (v1.10.0).
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
 *         name: deleted
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *           default: "false"
 *         description: Papierkorb anzeigen (nur eigene, gelöschte Notizen)
 *       - in: query
 *         name: folderId
 *         schema:
 *           type: string
 *         description: 'Ordner-Scope (v1.13.0) — "root" oder eine Notiz-ID; liefert nur die direkten Kinder dieses Knotens'
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Delta-Sync (v1.13.0) — nur Notizen mit updatedAt nach diesem Zeitpunkt. Ungültige Werte sind 400.
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
    const { search, tag, page, limit, archived, deleted, folderId, since } = req.query;

    const result = await notesService.getAllNotes({
      userId: req.user._id,
      search,
      tag,
      page: page || 1,
      limit: Math.min(parseInt(limit) || 50, 100),
      archived: archived || 'false',
      // Ohne diesen Filter konnte ein Sync-Script den Papierkorb nicht lesen —
      // und damit eine Löschung über die API nie rückgängig machen.
      deleted: deleted || 'false',
      // Parität mit der Web-API (v1.13.0): Ordner-Scope und Delta-Sync —
      // beides fehlte hier, obwohl Sync-Scripts die Hauptnutzer der v1 sind.
      folderId: folderId || undefined,
      since: since || undefined,
      // v1.14.0: Die v1-Antwort enthaelt counts/tags ohnehin nie — die vier
      // Zusaetzqueries pro Aufruf waren reine Verschwendung und entfallen.
      includeMeta: false
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
 * /api/v1/notes/tree:
 *   get:
 *     summary: Notiz-Baum abrufen (v1.13.0)
 *     description: Flache Liste aller aktiven/archivierten Knoten (inklusive geteilter, mit shared-Flag) zum clientseitigen Verschachteln.
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: since
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Nur geänderte Knoten (Delta-Sync)
 *     responses:
 *       200:
 *         description: Baum-Knoten
 */
router.get('/tree', async (req, res, next) => {
  try {
    const nodes = await notesService.getNoteTree(req.user._id, req.query.since);
    res.json({ success: true, data: nodes });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/meta:
 *   get:
 *     summary: Änderungs-Sonde (v1.13.0)
 *     description: Zaehlungen (aktiv/archiviert/Papierkorb) und max(updatedAt) in einer einzigen Aggregation — ein Sync-Script kann daran einen vollen Abruf aufhaengen.
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Metadaten des Bestands
 */
router.get('/meta', async (req, res, next) => {
  try {
    const meta = await notesService.getNotesMeta(req.user._id);
    res.json({ success: true, data: meta });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/export/markdown:
 *   get:
 *     summary: Gesamten Baum als Markdown-ZIP exportieren (v1.13.0)
 *     description: Round-trip-faehiges Volldaten-Backup — YAML-Frontmatter, Anhaenge unter assets/, Manifest. Gegenstueck ist POST /api/v1/notes/import/markdown (JSON-Items; Frontmatter wird geparst).
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: ZIP-Archiv
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/export/markdown', async (req, res, next) => {
  try {
    const archive = await notesService.buildMarkdownExport(req.user._id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="keeplocal-export.zip"');
    res.end(archive);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/import/markdown:
 *   post:
 *     summary: Markdown-Ordner-Chunk als JSON importieren (v1.13.0)
 *     description: 'Bulk-Anlage in einem Zug — { items: [{ path, title, content, tags? }] }, bis 500 Eintraege. Frontmatter im content wird geparst (Metadaten-Round-trip).'
 *     tags: [Notes]
 *     security:
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 500
 *                 items:
 *                   type: object
 *                   properties:
 *                     path:
 *                       type: string
 *                       description: Ordnerpfad (leer = Wurzel), /-getrennt
 *                     title:
 *                       type: string
 *                     content:
 *                       type: string
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *     responses:
 *       201:
 *         description: Importiert (created, foldersCreated, folderIds)
 *       400:
 *         description: Ungueltige items
 */
router.post('/import/markdown', requireApiKeyWrite, async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || !Array.isArray(req.body.items)) {
      return res.status(httpStatus.BAD_REQUEST).json({
        success: false,
        error: 'items (Array) ist erforderlich'
      });
    }
    const result = await notesService.importMarkdownNotes(req.user._id, req.body.items, {});
    res.status(httpStatus.CREATED).json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(httpStatus.BAD_REQUEST).json({ success: false, error: error.message });
    }
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
router.post('/', requireApiKeyWrite, async (req, res, next) => {
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
router.put('/:id', requireApiKeyWrite, async (req, res, next) => {
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
    if (error.statusCode === httpStatus.CONFLICT) {
      // Optimistic Locking: Ein Sync-Skript kann auf 409 mit Retry reagieren,
      // statt einen Serverfehler zu sehen. Der frische Server-Stand reist mit.
      return res.status(httpStatus.CONFLICT).json({
        success: false,
        error: error.message,
        currentNote: error.currentNote
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
 *       - in: query
 *         name: permanent
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *           default: "false"
 *         description: '"true" löscht eine Notiz im Papierkorb endgültig (inkl. Bilder)'
 *     responses:
 *       200:
 *         description: Ohne permanent in den Papierkorb verschoben (30 Tage), mit permanent=true endgültig gelöscht
 *       404:
 *         description: Notiz nicht gefunden
 */
router.delete('/:id', requireApiKeyWrite, async (req, res, next) => {
  try {
    // Ehrliche Semantik: Seit dem Papierkorb (PR #106) ist deleteNote ein Soft
    // Delete. Die v1-API antwortete weiter „Notiz gelöscht“ und bot weder
    // `permanent` noch `restore` noch einen `deleted`-Filter — ein Sync-Script
    // sah die Notiz verschwinden und konnte sie über die API nie zurückholen.
    const permanent = req.query.permanent === 'true';
    const deletedNote = permanent
      ? await notesService.purgeNote(req.params.id, req.user._id)
      : await notesService.deleteNote(req.params.id, req.user._id);

    res.json({
      success: true,
      message: permanent ? 'Notiz endgültig gelöscht' : 'Notiz in den Papierkorb verschoben',
      permanent,
      deletedAt: deletedNote?.deletedAt || null,
      data: deletedNote
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
 * /api/v1/notes/{id}/restore:
 *   post:
 *     summary: Notiz aus dem Papierkorb wiederherstellen
 *     tags: [Notes v1]
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
 *         description: Notiz wiederhergestellt
 *       404:
 *         description: Notiz nicht gefunden oder nicht im Papierkorb
 */
router.post('/:id/restore', requireApiKeyWrite, async (req, res, next) => {
  try {
    const note = await notesService.restoreNote(req.params.id, req.user._id);
    res.json({
      success: true,
      message: 'Notiz wiederhergestellt',
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
router.post('/:id/pin', requireApiKeyWrite, async (req, res, next) => {
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
router.post('/:id/archive', requireApiKeyWrite, async (req, res, next) => {
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
 * /api/v1/notes/{id}/images:
 *   post:
 *     summary: Bilder an eine Notiz anhängen (v1.15.0)
 *     description: 'Multipart/form-data, Feld `images`, max. 5 Dateien à 10 MB, max. 25 Bilder pro Notiz. Dieselbe Pipeline wie die Web-App: Magic-Bytes-Prüfung, Auflösungs-Limit, Thumbnail-Erzeugung. Die resultierende /uploads-URL ist mit demselben API-Key abrufbar.'
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Aktualisierte Notiz (inkl. images[])
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Note'
 *       400:
 *         description: Ungültige Dateien oder Limit überschritten
 *       404:
 *         description: Notiz nicht gefunden
 */
router.post('/:id/images', requireApiKeyWrite, v1ResponseEnvelope, blockDemoUploads, noteValidation.getOne, requireEditableNote,
  rejectIfAttachmentFull('images'),
  wrapUpload(upload.array('images', 5), { sizeLabel: '10MB', kindLabel: 'Bilder' }),
  handleImageUpload);

/**
 * @swagger
 * /api/v1/notes/{id}/files:
 *   post:
 *     summary: PDF-Anhänge an eine Notiz hängen (v1.15.0)
 *     description: 'Multipart/form-data, Feld `files`, max. 5 PDFs à 25 MB, max. 25 Anhänge pro Notiz. Magic-Byte-Prüfung (%PDF-) wie die Web-App.'
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Aktualisierte Notiz (inkl. files[])
 *       400:
 *         description: Ungültige Dateien oder Limit überschritten
 *       404:
 *         description: Notiz nicht gefunden
 */
router.post('/:id/files', requireApiKeyWrite, v1ResponseEnvelope, blockDemoUploads, noteValidation.getOne, requireEditableNote,
  rejectIfAttachmentFull('files'),
  wrapUpload(uploadPdf.array('files', 5), { sizeLabel: '25MB', kindLabel: 'Anhänge' }),
  handleFileUpload);

/**
 * @swagger
 * /api/v1/notes/{id}/images/{filename}:
 *   delete:
 *     summary: Bild von einer Notiz lösen und Datei löschen (v1.15.0)
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
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Gespeicherter Dateiname (note.images[].filename, nicht die URL)
 *     responses:
 *       200:
 *         description: Aktualisierte Notiz
 *       404:
 *         description: Notiz oder Bild nicht gefunden
 */
router.delete('/:id/images/:filename', requireApiKeyWrite, blockDemoUploads, noteValidation.getOne, async (req, res, next) => {
  try {
    if (!isSafeStoredFilename(req.params.filename)) {
      return res.status(httpStatus.BAD_REQUEST).json({ success: false, error: 'Ungueltiger Dateiname' });
    }

    const note = await notesService.removeImage(req.params.id, req.user._id, req.params.filename);

    const filepath = path.join(imagesDir(), req.params.filename);
    await fs.promises.rm(filepath, { force: true });

    const ext = path.extname(req.params.filename);
    const nameWithoutExt = path.basename(req.params.filename, ext);
    await fs.promises.rm(path.join(imagesDir(), `${nameWithoutExt}-thumb.webp`), { force: true });

    res.json({ success: true, data: note });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ success: false, error: 'Notiz oder Bild nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/notes/{id}/files/{filename}:
 *   delete:
 *     summary: PDF-Anhang von einer Notiz lösen und Datei löschen (v1.15.0)
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
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Gespeicherter Dateiname (note.files[].filename, nicht die URL)
 *     responses:
 *       200:
 *         description: Aktualisierte Notiz
 *       404:
 *         description: Notiz oder Anhang nicht gefunden
 */
router.delete('/:id/files/:filename', requireApiKeyWrite, blockDemoUploads, noteValidation.getOne, async (req, res, next) => {
  try {
    if (!isSafeStoredFilename(req.params.filename)) {
      return res.status(httpStatus.BAD_REQUEST).json({ success: false, error: 'Ungueltiger Dateiname' });
    }

    const note = await notesService.removeFile(req.params.id, req.user._id, req.params.filename);
    await fs.promises.rm(path.join(filesDir(), req.params.filename), { force: true });

    res.json({ success: true, data: note });
  } catch (error) {
    if (error.statusCode === 404 || error.kind === 'ObjectId') {
      return res.status(httpStatus.NOT_FOUND).json({ success: false, error: 'Notiz oder Anhang nicht gefunden' });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
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
router.post('/:id/share', requireApiKeyWrite, async (req, res, next) => {
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
router.delete('/:id/share/:userId', requireApiKeyWrite, async (req, res, next) => {
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
