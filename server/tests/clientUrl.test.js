const test = require('node:test');
const assert = require('node:assert/strict');

const { getClientURL } = require('../utils/clientUrl');

function request(host, forwardedProto = 'https') {
  return {
    headers: { host, 'x-forwarded-proto': forwardedProto },
    protocol: 'http'
  };
}

test('OAuth redirects prefer an explicitly configured client origin', () => {
  const result = getClientURL(request('attacker.example'), {
    CLIENT_URL: 'https://notes.example/app',
    ALLOWED_ORIGINS: 'https://other.example',
    NODE_ENV: 'production'
  });

  assert.equal(result, 'https://notes.example');
});

test('OAuth redirects reject an unlisted production Host header', () => {
  const result = getClientURL(request('attacker.example'), {
    ALLOWED_ORIGINS: 'https://notes.example,https://notes-alt.example',
    NODE_ENV: 'production'
  });

  assert.equal(result, 'https://notes.example');
});

test('OAuth redirects may use a listed request origin', () => {
  const result = getClientURL(request('notes-alt.example'), {
    ALLOWED_ORIGINS: 'https://notes.example,https://notes-alt.example',
    NODE_ENV: 'production'
  });

  assert.equal(result, 'https://notes-alt.example');
});
