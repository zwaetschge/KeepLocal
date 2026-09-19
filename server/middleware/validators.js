const { body, param, query, validationResult } = require('express-validator');
const { publicValidationErrors } = require('../utils/validationErrors');

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = publicValidationErrors(errors);
    // Only log validation errors, not the full request body (which may contain sensitive data)
    console.log('Validation errors:', JSON.stringify(details.map(error => error.msg), null, 2));
    return res.status(400).json({
      error: 'Validierungsfehler',
      details
    });
  }
  next();
};

// Note validation rules
const noteValidationRules = {
  create: [
    body('title')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Titel darf maximal 200 Zeichen lang sein'),

    body('content')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 10000 })
      .withMessage('Inhalt darf maximal 10.000 Zeichen lang sein'),

    body('color')
      .optional()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('Farbe muss ein gültiger Hex-Code sein (z.B. #ffffff)'),

    body('isPinned')
      .optional()
      .isBoolean()
      .withMessage('isPinned muss ein Boolean sein'),

    // Erinnerung (v1.8.0): null loescht sie, sonst ISO-8601-Datum/-Zeit.
    body('remindAt')
      .optional({ nullable: true })
      .custom((value) => value === null || value instanceof Date || !Number.isNaN(Date.parse(value)))
      .withMessage('remindAt muss ein Datum oder null sein'),
    body('isCode')
      .optional()
      .isBoolean()
      .withMessage('isCode muss ein Boolean sein'),

    // Baum (v1.10.0): null = Wurzel. Existenz/Eigentum/Zyklus prueft der Service.
    body('parentId')
      .optional({ nullable: true })
      .isMongoId()
      .withMessage('parentId muss eine Notiz-ID oder null sein'),

    body('tags')
      .optional()
      .isArray({ max: 50 })
      .withMessage('Tags müssen ein Array sein'),

    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Jeder Tag muss zwischen 1 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9äöüÄÖÜß\-_]+$/)
      .withMessage('Tags dürfen nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

    body('isTodoList')
      .optional()
      .isBoolean()
      .withMessage('isTodoList muss ein Boolean sein'),

    body('todoItems')
      .optional()
      .isArray({ max: 200 })
      .withMessage('todoItems muss ein Array sein'),

    body('todoItems.*.text')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Todo-Item Text darf maximal 500 Zeichen lang sein'),

    body('todoItems.*.completed')
      .optional()
      .isBoolean()
      .withMessage('Todo-Item completed muss ein Boolean sein'),

    body('todoItems.*.order')
      .optional()
      .isInt()
      .withMessage('Todo-Item order muss eine Ganzzahl sein'),

    body('linkPreviews')
      .optional()
      .isArray({ max: 20 })
      .withMessage('linkPreviews muss ein Array sein'),

    body('linkPreviews.*.url')
      .optional()
      .trim()
      .isURL()
      .withMessage('Link-Preview URL muss eine gültige URL sein'),

    body('linkPreviews.*.title')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Link-Preview Titel darf maximal 200 Zeichen lang sein'),

    body('linkPreviews.*.description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Link-Preview Beschreibung darf maximal 500 Zeichen lang sein'),

    body('linkPreviews.*.image')
      .optional({ checkFalsy: true })
      .trim()
      .isURL()
      .withMessage('Link-Preview Bild muss eine gültige URL sein'),

    body('linkPreviews.*.siteName')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Link-Preview Site Name darf maximal 100 Zeichen lang sein'),

    handleValidationErrors
  ],

  update: [
    param('id')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    body('title')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Titel darf maximal 200 Zeichen lang sein'),

    body('content')
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 10000 })
      .withMessage('Inhalt darf maximal 10.000 Zeichen lang sein'),

    body('color')
      .optional()
      .matches(/^#[0-9A-Fa-f]{6}$/)
      .withMessage('Farbe muss ein gültiger Hex-Code sein (z.B. #ffffff)'),

    body('isPinned')
      .optional()
      .isBoolean()
      .withMessage('isPinned muss ein Boolean sein'),

    // Erinnerung (v1.8.0): null loescht sie, sonst ISO-8601-Datum/-Zeit.
    body('remindAt')
      .optional({ nullable: true })
      .custom((value) => value === null || value instanceof Date || !Number.isNaN(Date.parse(value)))
      .withMessage('remindAt muss ein Datum oder null sein'),
    body('isCode')
      .optional()
      .isBoolean()
      .withMessage('isCode muss ein Boolean sein'),

    // Baum (v1.10.0): null = Wurzel. Existenz/Eigentum/Zyklus prueft der Service.
    body('parentId')
      .optional({ nullable: true })
      .isMongoId()
      .withMessage('parentId muss eine Notiz-ID oder null sein'),

    body('tags')
      .optional()
      .isArray({ max: 50 })
      .withMessage('Tags müssen ein Array sein'),

    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Jeder Tag muss zwischen 1 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9äöüÄÖÜß\-_]+$/)
      .withMessage('Tags dürfen nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

    body('isTodoList')
      .optional()
      .isBoolean()
      .withMessage('isTodoList muss ein Boolean sein'),

    body('todoItems')
      .optional()
      .isArray({ max: 200 })
      .withMessage('todoItems muss ein Array sein'),

    body('todoItems.*.text')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Todo-Item Text darf maximal 500 Zeichen lang sein'),

    body('todoItems.*.completed')
      .optional()
      .isBoolean()
      .withMessage('Todo-Item completed muss ein Boolean sein'),

    body('todoItems.*.order')
      .optional()
      .isInt()
      .withMessage('Todo-Item order muss eine Ganzzahl sein'),

    body('linkPreviews')
      .optional()
      .isArray({ max: 20 })
      .withMessage('linkPreviews muss ein Array sein'),

    body('linkPreviews.*.url')
      .optional()
      .trim()
      .isURL()
      .withMessage('Link-Preview URL muss eine gültige URL sein'),

    body('linkPreviews.*.title')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('Link-Preview Titel darf maximal 200 Zeichen lang sein'),

    body('linkPreviews.*.description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Link-Preview Beschreibung darf maximal 500 Zeichen lang sein'),

    body('linkPreviews.*.image')
      .optional({ checkFalsy: true })
      .trim()
      .isURL()
      .withMessage('Link-Preview Bild muss eine gültige URL sein'),

    body('linkPreviews.*.siteName')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Link-Preview Site Name darf maximal 100 Zeichen lang sein'),

    handleValidationErrors
  ],

  getOne: [
    param('id')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    handleValidationErrors
  ],

  delete: [
    param('id')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    handleValidationErrors
  ],

  pin: [
    param('id')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    handleValidationErrors
  ],

  search: [
    query('search')
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Suchbegriff darf maximal 100 Zeichen lang sein'),

    query('tag')
      .optional()
      .trim()
      .isLength({ max: 50 })
      .withMessage('Tag darf maximal 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9äöüÄÖÜß\-_]+$/)
      .withMessage('Tag darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Seitenzahl muss eine positive Ganzzahl sein'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit muss zwischen 1 und 100 liegen'),

    query('archived')
      .optional()
      .isIn(['true', 'false'])
      .withMessage('archived muss true oder false sein'),

    query('deleted')
      .optional()
      .isIn(['true', 'false'])
      .withMessage('deleted muss true oder false sein'),

    handleValidationErrors
  ],

  // DELETE /api/notes/:id?permanent=true — endgültiges Löschen aus dem Papierkorb
  remove: [
    param('id')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    query('permanent')
      .optional()
      .isIn(['true', 'false'])
      .withMessage('permanent muss true oder false sein'),

    handleValidationErrors
  ],

  // PATCH /api/notes/reorder — manuelle Reihenfolge (Drag & Drop)
  reorder: [
    body('orderedIds')
      .isArray({ min: 1, max: 200 })
      .withMessage('orderedIds muss ein Array mit 1 bis 200 Notiz-IDs sein'),

    body('orderedIds.*')
      .isMongoId()
      .withMessage('Ungültige Notiz-ID'),

    handleValidationErrors
  ]
};

module.exports = noteValidationRules;
