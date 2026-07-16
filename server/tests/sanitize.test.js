const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeObject } = require('../utils/sanitize');

test('sanitization recurses into objects nested in arrays', () => {
  const result = sanitizeObject({
    todoItems: [{ text: '<script>alert(1)</script>safe' }]
  });

  assert.deepEqual(result, { todoItems: [{ text: 'safe' }] });
});

test('sanitization never changes passwords or authentication tokens', () => {
  const password = 'Abc12345<script>&';
  const token = '<signed-token>';
  const result = sanitizeObject({ password, token });

  assert.equal(result.password, password);
  assert.equal(result.token, token);
});
