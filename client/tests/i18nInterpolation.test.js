const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/i18n.mjs')
).href;

test('interpolate replaces named tokens with param values', async () => {
  const { interpolate } = await import(moduleUrl);

  assert.equal(
    interpolate('Geteilt mit {count}', { count: 3 }),
    'Geteilt mit 3'
  );
  assert.equal(
    interpolate('Do you really want to delete the user "{username}"?', { username: 'ada' }),
    'Do you really want to delete the user "ada"?'
  );
});

test('interpolate replaces every occurrence of a token and coerces values', async () => {
  const { interpolate } = await import(moduleUrl);

  assert.equal(
    interpolate('{a} und {a}', { a: 1 }),
    '1 und 1'
  );
  assert.equal(interpolate('{ok}', { ok: false }), 'false');
  assert.equal(interpolate('{n}', { n: null }), 'null');
});

test('interpolate keeps unknown tokens instead of deleting them', async () => {
  const { interpolate } = await import(moduleUrl);

  assert.equal(interpolate('Hello {name}!', {}), 'Hello {name}!');
  assert.equal(interpolate('Hello {name}!', { other: 'x' }), 'Hello {name}!');
});

test('interpolate is backwards compatible without params', async () => {
  const { interpolate } = await import(moduleUrl);

  assert.equal(interpolate('Plain text'), 'Plain text');
  assert.equal(interpolate('Plain text', undefined), 'Plain text');
  assert.equal(interpolate('Plain text', null), 'Plain text');
  assert.equal(interpolate(undefined, { a: 1 }), undefined);
  assert.equal(interpolate(null, { a: 1 }), null);
});

test('interpolate ignores non-object params and prototype keys', async () => {
  const { interpolate } = await import(moduleUrl);

  // A string is not a params object — must not blow up or replace anything.
  assert.equal(interpolate('{a}', 'nope'), '{a}');
  // hasOwnProperty guard: no prototype pollution lookups.
  assert.equal(interpolate('{toString}', {}), '{toString}');
});

test('LanguageContext t() forwards params to interpolate', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/contexts/LanguageContext.jsx'),
    'utf8'
  );

  assert.match(source, /const t = useCallback\(\(key, params\)/);
  assert.match(source, /interpolate\(template, params\)/);
});

test('call sites use t() params instead of manual replace()', () => {
  const noteSource = fs.readFileSync(
    path.join(__dirname, '../src/components/Note.jsx'),
    'utf8'
  );
  const adminSource = fs.readFileSync(
    path.join(__dirname, '../src/components/AdminConsole.jsx'),
    'utf8'
  );

  assert.doesNotMatch(noteSource, /t\('[^']+'\)\.replace\(/);
  assert.doesNotMatch(adminSource, /t\('[^']+'\)\.replace\(/);
  assert.match(noteSource, /t\('sharedWithCount', \{ count:/);
  assert.match(adminSource, /t\('deleteUserMessage', \{ username:/);
});
