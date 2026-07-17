function safeErrorValue(readValue, fallback = '') {
  try {
    return String(readValue() ?? fallback);
  } catch {
    return fallback;
  }
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
    name
  };
}
