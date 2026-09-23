// Error Handler Middleware
const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('request failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status: Number(err.statusCode || err.status) || 500,
    name: err.name,
    message: err.message,
    code: err.code,
    // Only unexpected errors keep a stack trace; a validation failure is noise.
    stack: Number(err.statusCode || err.status) >= 500 ? err.stack : undefined
  });

  let statusCode = Number(err.statusCode || err.status) || 500;
  let message = err.message || 'Ein Serverfehler ist aufgetreten';

  if (err.name === 'ValidationError') {
    statusCode = 400;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Ungueltige ID';
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'Ein Eintrag mit diesen Daten existiert bereits';
  } else if (err.name === 'VersionError') {
    // Gleichzeitige Schreiber: Das Dokument changed zwischen Lesen und
    // save() — ein Konflikt (409), kein Serverfehler. Einzige realistische
    // Quelle ist die Array-Versionierung der Note (siehe Top-30 Nr. 12).
    statusCode = 409;
    message = 'Die Notiz wurde inzwischen geändert';
  } else if (err.name === 'DocumentNotFoundError') {
    statusCode = 404;
    message = 'Eintrag nicht gefunden';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Ungueltiger JSON-Request';
  }

  if (statusCode >= 500 && process.env.NODE_ENV !== 'development') {
    message = 'Ein Serverfehler ist aufgetreten';
  }

  const requestId = req.id;

  // Use consistent format for v1 API routes
  if (req.originalUrl.startsWith('/api/v1')) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      ...(typeof err.code === 'string' && { code: err.code }),
      ...(requestId && { requestId }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  res.status(statusCode).json({
    error: message,
    // Maschinenlesbarer Fehlercode (v1.16.0-Review): STORAGE_QUOTA_EXCEEDED &
    // Co. reisten bisher nur in den beiden Upload-Handlern mit — der ZIP-
    // Import-Path (next(error)) verlor das Feld. Nur Strings: Mongoose hängt
    // numerische Codes an (11000 = Duplicate Key), die hätten hier nichts
    // verloren.
    ...(typeof err.code === 'string' && { code: err.code }),
    ...(requestId && { requestId }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = errorHandler;
