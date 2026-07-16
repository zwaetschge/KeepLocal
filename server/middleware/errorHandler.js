// Error Handler Middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

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
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Ungueltiger JSON-Request';
  }

  if (statusCode >= 500 && process.env.NODE_ENV !== 'development') {
    message = 'Ein Serverfehler ist aufgetreten';
  }

  // Use consistent format for v1 API routes
  if (req.originalUrl.startsWith('/api/v1')) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

module.exports = errorHandler;
