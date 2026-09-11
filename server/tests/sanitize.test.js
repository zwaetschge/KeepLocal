const test = require('node:test');
const assert = require('node:assert');
const { escapeRegex } = require('../utils/sanitize');

test('escapeRegex escapes all regular expression metacharacters', () => {
  assert.equal(escapeRegex('a.b*c[d]e(f)g+h?i^j{k}l|m\\n'), 'a\\.b\\*c\\[d\\]e\\(f\\)g\\+h\\?i\\^j\\{k\\}l\\|m\\\\n');
  assert.equal(escapeRegex(42), '');
  assert.equal(escapeRegex(null), '');
});

test('plain-text note fields round-trip unchanged (no destructive HTML filter)', () => {
  // Guard against re-introducing a server-side HTML filter over plain-text
  // fields: it silently dropped everything after "<" (BUG_REPORT 2026-08-15, #1).
  // Rendering-side sanitization (DOMPurify / React text nodes) is the contract.
  const build = require('../services/notesService').buildNotesQuery;
  const query = build({ userId: 'u', search: 'Preis < 100 EUR', isArchived: false });
  assert.equal(query.$text.$search, 'Preis < 100 EUR');
});
