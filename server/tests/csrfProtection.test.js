const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';

test('CSRF tokens are signed and reject tampering', () => {
  const { createCsrfToken, verifyCsrfToken } = require('../middleware/csrfProtection');
  const token = createCsrfToken();

  assert.match(token, /^[a-f0-9]{64}\.[a-f0-9]{64}$/);
  assert.equal(verifyCsrfToken(token), true);

  const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.equal(verifyCsrfToken(tampered), false);
  assert.equal(verifyCsrfToken('invalid'), false);
});

test('CSRF middleware requires matching cookie and header on unsafe methods', () => {
  const { createCsrfToken, csrfProtection } = require('../middleware/csrfProtection');
  const token = createCsrfToken();
  let statusCode;
  let payload;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      payload = body;
    }
  };

  csrfProtection({ method: 'POST', cookies: { kl_csrf: token }, headers: {} }, response, () => {
    assert.fail('request without a CSRF header must not continue');
  });

  assert.equal(statusCode, 403);
  assert.equal(payload.error, 'Ungueltiges CSRF-Token');

  let continued = false;
  csrfProtection({
    method: 'POST',
    cookies: { kl_csrf: token },
    headers: { 'x-csrf-token': token }
  }, response, () => {
    continued = true;
  });
  assert.equal(continued, true);
});
