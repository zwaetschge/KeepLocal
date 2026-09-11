/**
 * Minimal structured logger — no dependency, two output modes.
 *
 * Human lines (default) keep the current log reading; `LOG_FORMAT=json` emits one
 * JSON object per line with the request id, which is what a log shipper and the
 * AI service correlation need. Secrets are redacted in both modes: cookie and
 * authorization headers, CSRF tokens and password fields never reach a log file.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const REDACTED_KEYS = [
  'cookie',
  'set-cookie',
  'authorization',
  'x-csrf-token',
  'x-api-key',
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'resetToken',
  'csrfToken',
  'sessionVersion'
];

const levelFromEnv = () => {
  const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[configured] === undefined ? LEVELS.info : LEVELS[configured];
};

const jsonMode = () => String(process.env.LOG_FORMAT || '').toLowerCase() === 'json';

/**
 * Deep-clone a value with secret-looking keys replaced, bounded in depth so a
 * circular request object cannot blow the stack or the log line.
 */
function redact(value, depth = 0) {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, statusCode: value.statusCode };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => redact(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.some(secret => key.toLowerCase() === secret.toLowerCase())
        ? '[redacted]'
        : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level, message, context) {
  if (LEVELS[level] > levelFromEnv()) return;

  if (jsonMode()) {
    const line = {
      time: new Date().toISOString(),
      level,
      message,
      ...(context ? redact(context) : {})
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
    return;
  }

  const suffix = context
    ? ` ${Object.entries(redact(context))
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' ')}`
    : '';
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${level.toUpperCase()} ${message}${suffix}\n`);
}

const logger = {
  error: (message, context) => emit('error', message, context),
  warn: (message, context) => emit('warn', message, context),
  info: (message, context) => emit('info', message, context),
  debug: (message, context) => emit('debug', message, context),
  redact
};

module.exports = logger;
