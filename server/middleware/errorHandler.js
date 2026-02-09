// Error Handler Middleware
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Ein Serverfehler ist aufgetreten';

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
