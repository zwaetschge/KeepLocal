const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredOrigins,
  PUBLIC_DEMO_ORIGIN,
} = require('../config/allowedOrigins');
test('public demo admits its packaged frontend even when an older container only lists the backend', () => {
  assert.deepEqual(
    configuredOrigins({
      DEMO_MODE: 'true',
      ALLOWED_ORIGINS: 'https://backend.example',
    }),
    ['https://backend.example', PUBLIC_DEMO_ORIGIN],
  );
});
test('private production never inherits public demo trust or wildcard preview domains', () => {
  assert.deepEqual(
    configuredOrigins({ ALLOWED_ORIGINS: 'https://notes.example' }),
    ['https://notes.example'],
  );
  assert.throws(() =>
    configuredOrigins({
      DEMO_MODE: 'true',
      DEMO_FRONTEND_ORIGIN: 'https://*.vercel.app/path',
    }),
  );
});
