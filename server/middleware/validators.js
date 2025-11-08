const { body, param, query, validationResult } = require('express-validator');

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validierungsfehler',
      details: errors.array()
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
      .trim()
      .notEmpty()
      .withMessage('Inhalt ist erforderlich')
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

    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags müssen ein Array sein'),

    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Jeder Tag muss zwischen 1 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9äöüÄÖÜß\-_]+$/)
      .withMessage('Tags dürfen nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

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
      .trim()
      .notEmpty()
      .withMessage('Inhalt ist erforderlich')
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

    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags müssen ein Array sein'),

    body('tags.*')
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Jeder Tag muss zwischen 1 und 50 Zeichen lang sein')
      .matches(/^[a-zA-Z0-9äöüÄÖÜß\-_]+$/)
      .withMessage('Tags dürfen nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

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

    handleValidationErrors
  ]
};

module.exports = noteValidationRules;
