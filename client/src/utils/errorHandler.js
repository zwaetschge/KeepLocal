/**
 * Error Handler Utilities
 * Centralized error handling and formatting
 */

/**
 * Error types for categorization
 */
export const ErrorTypes = {
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  VALIDATION: 'VALIDATION',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN',
};

/**
 * Parse error from API response
 * @param {Error|Object} error - Error object or response
 * @returns {Object} Parsed error with type and message
 */
export function parseError(error) {
  // Network errors
  if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
    return {
      type: ErrorTypes.NETWORK,
      message: 'Netzwerkfehler. Bitte überprüfen Sie Ihre Internetverbindung.',
      originalError: error,
    };
  }

  // Auth errors
  if (error.message?.includes('401') || error.message?.includes('autorisiert')) {
    return {
      type: ErrorTypes.AUTH,
      message: 'Nicht autorisiert. Bitte melden Sie sich erneut an.',
      originalError: error,
    };
  }

  // Validation errors
  if (error.message?.includes('400') || error.message?.includes('invalid')) {
    return {
      type: ErrorTypes.VALIDATION,
      message: error.message || 'Ungültige Eingabe.',
      originalError: error,
    };
  }

  // Server errors
  if (error.message?.includes('500') || error.message?.includes('503')) {
    return {
      type: ErrorTypes.SERVER,
      message: 'Serverfehler. Bitte versuchen Sie es später erneut.',
      originalError: error,
    };
  }

  // Default unknown error
  return {
    type: ErrorTypes.UNKNOWN,
    message: error.message || 'Ein unbekannter Fehler ist aufgetreten.',
    originalError: error,
  };
}

/**
 * Log error to console (could be extended to send to error tracking service)
 * @param {Error|Object} error - Error to log
 * @param {string} context - Context where error occurred
 */
export function logError(error, context = '') {
  const parsedError = parseError(error);

  console.error(`[${parsedError.type}] ${context}:`, {
    message: parsedError.message,
    originalError: parsedError.originalError,
    timestamp: new Date().toISOString(),
  });

  // TODO: Send to error tracking service (Sentry, etc.)
  // if (process.env.NODE_ENV === 'production') {
  //   sendToErrorTracker(parsedError, context);
  // }
}

/**
 * Handle async errors with toast notifications
 * @param {Function} asyncFn - Async function to execute
 * @param {Function} showToast - Toast notification function
 * @param {string} context - Context for error logging
 * @returns {Function} Wrapped function with error handling
 */
export function withErrorHandler(asyncFn, showToast, context = '') {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      const parsedError = parseError(error);
      logError(error, context);

      if (showToast) {
        showToast(parsedError.message, 'error');
      }

      throw error;
    }
  };
}

/**
 * Create a user-friendly error message
 * @param {Error|Object} error - Error object
 * @param {string} defaultMessage - Default message if parsing fails
 * @returns {string} User-friendly error message
 */
export function getUserMessage(error, defaultMessage = 'Ein Fehler ist aufgetreten') {
  const parsedError = parseError(error);
  return parsedError.message || defaultMessage;
}
