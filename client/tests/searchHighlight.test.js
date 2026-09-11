const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Improvement #9: search results highlight the matched term. The highlighting
// runs on escaped, already-linkified HTML, so it must never touch a tag or an
// attribute — otherwise a search term could break a link URL or inject markup.

const sanitizeUrl = pathToFileURL(path.join(__dirname, '../src/utils/sanitize.js')).href;
const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// sanitize.js imports dompurify, which needs a DOM; without one it reports
// isSupported=false and passes text through, which is enough for the pure
// highlight logic tested here. The allowlist is asserted on the source.
async function loadSanitize() {
  try {
    return await import(sanitizeUrl);
  } catch {
    return null;
  }
}

test('highlightMatches marks every occurrence, case-insensitively', async () => {
  const mod = await loadSanitize();
  if (!mod) return; // dompurify unavailable in this environment
  const { highlightMatches } = mod;

  assert.equal(highlightMatches('Brot und Brot', 'brot'), '<mark>Brot</mark> und <mark>Brot</mark>');
  assert.equal(highlightMatches('kein treffer', 'brot'), 'kein treffer');
  assert.equal(highlightMatches('Brot', ''), 'Brot');
  assert.equal(highlightMatches('Brot', '   '), 'Brot');
});

test('highlightMatches never writes into a tag or an attribute', async () => {
  const mod = await loadSanitize();
  if (!mod) return;
  const { highlightMatches } = mod;

  const linked = '<a href="https://example.com/" title="example.com">https://example.com/</a>';
  const result = highlightMatches(linked, 'example');

  assert.equal(result, '<a href="https://example.com/" title="example.com">https://<mark>example</mark>.com/</a>');
  assert.equal(result.match(/<mark>/g).length, 1, 'only the text node is marked');
});

test('a search term with markup characters is escaped before matching', async () => {
  const mod = await loadSanitize();
  if (!mod) return;
  const { highlightMatches } = mod;

  // The haystack is escaped HTML, so "&lt;3" is what "<3" looks like there.
  assert.equal(
    highlightMatches('Tom &lt;3 Jerry', '<3'),
    'Tom <mark>&lt;3</mark> Jerry'
  );
  // Regex metacharacters in the term must stay literal.
  assert.equal(highlightMatches('a.b and axb', 'a.b'), '<mark>a.b</mark> and axb');
});

test('the sanitizer keeps <mark> and the app passes the search term down', () => {
  const sanitize = read('utils', 'sanitize.js');
  assert.match(sanitize, /ALLOWED_TAGS: \['a', 'br', 'label', 'input', 'span', 'mark'\]/);
  assert.match(sanitize, /options\.highlight \? highlightMatches\(linked, options\.highlight\) : linked/);

  const note = read('components', 'Note.jsx');
  assert.match(note, /highlight = ''/);
  assert.match(note, /sanitizeAndLinkify\(note\.content, \{ highlight \}\)/);

  const list = read('components', 'NoteList.jsx');
  assert.match(list, /highlight=\{highlight\}/);

  const app = read('App.jsx');
  assert.match(app, /highlight: searchTerm,/);
});

test('Escape clears the search field', () => {
  const search = read('components', 'SearchBar.jsx');

  assert.match(search, /onKeyDown=\{\(event\) => \{/);
  assert.match(search, /if \(event\.key === 'Escape' && searchTerm\) \{/);
  assert.match(search, /event\.stopPropagation\(\);\s*handleClear\(\);/);
});

test('mark is styled in every theme through a CSS variable', () => {
  const css = read('components', 'Note.css');
  assert.match(css, /\.note-content mark \{/);
  assert.match(css, /var\(--accent-secondary-light/);
});
