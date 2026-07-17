const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/errorDiagnostic.mjs')
).href;

test('error diagnostics are stable and do not expose the error message', async () => {
  const { buildErrorDiagnostic } = await import(moduleUrl);
  const error = new Error('private page details');
  const errorInfo = { componentStack: '\n    at LanguageProvider' };

  const first = buildErrorDiagnostic(error, errorInfo);
  const second = buildErrorDiagnostic(error, errorInfo);

  assert.deepEqual(first, second);
  assert.match(first.code, /^KL-[0-9A-F]{8}$/);
  assert.equal(first.name, 'Error');
  assert.equal(first.message, '');
  assert.doesNotMatch(JSON.stringify(first), /private page details/);
});

test('error diagnostics show a bounded redacted TypeError hint', async () => {
  const { buildErrorDiagnostic } = await import(moduleUrl);
  const error = new TypeError(
    'Failed for https://private.example/path user@example.com abcdefghijklmnopqrstuvwxyz123456'
  );

  const diagnostic = buildErrorDiagnostic(error, {});

  assert.equal(diagnostic.name, 'TypeError');
  assert.match(diagnostic.message, /\[URL\]/);
  assert.match(diagnostic.message, /\[E-Mail\]/);
  assert.match(diagnostic.message, /\[Wert\]/);
  assert.doesNotMatch(diagnostic.message, /private\.example|user@example\.com|abcdefghijklmnopqrstuvwxyz/);
});
