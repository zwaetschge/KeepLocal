const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/errorDiagnostic.mjs')
).href;

test('error diagnostics are stable and do not expose the error message', async () => {
  const { buildErrorDiagnostic } = await import(moduleUrl);
  const error = new DOMException('private page details', 'SecurityError');
  const errorInfo = { componentStack: '\n    at LanguageProvider' };

  const first = buildErrorDiagnostic(error, errorInfo);
  const second = buildErrorDiagnostic(error, errorInfo);

  assert.deepEqual(first, second);
  assert.match(first.code, /^KL-[0-9A-F]{8}$/);
  assert.equal(first.name, 'SecurityError');
  assert.doesNotMatch(JSON.stringify(first), /private page details/);
});
