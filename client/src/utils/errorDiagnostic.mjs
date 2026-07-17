function safeErrorValue(readValue, fallback = '') {
  try {
    return String(readValue() ?? fallback);
  } catch {
    return fallback;
  }
}

const SAFE_MESSAGE_ERROR_NAMES = new Set([
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
  'SecurityError',
  'NotSupportedError',
  'InvalidStateError'
]);

function redactErrorMessage(message) {
  return message
    .replace(/https?:\/\/[^\s)]+/gi, '[URL]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[E-Mail]')
    .replace(/\b[a-z0-9_-]{32,}\b/gi, '[Wert]')
    .replace(/(["'`])([^\n]{40,})\1/g, '$1[Wert]$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export function buildErrorDiagnostic(error, errorInfo) {
  const name = safeErrorValue(() => error?.name, 'Error')
    .replace(/[^a-z0-9_.-]/gi, '')
    .slice(0, 40) || 'Error';
  const message = safeErrorValue(() => error?.message || error);
  const componentStack = safeErrorValue(() => errorInfo?.componentStack);
  const fingerprint = `${name}|${message}|${componentStack}`;
  let hash = 2166136261;

  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return {
    code: `KL-${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}`,
    name,
    message: SAFE_MESSAGE_ERROR_NAMES.has(name) ? redactErrorMessage(message) : ''
  };
}
