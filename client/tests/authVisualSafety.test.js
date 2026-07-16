const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('auth screens remain scrollable and avoid the legacy purple gradients', () => {
  const css = fs.readFileSync(path.join(root, 'src/components/Auth.css'), 'utf8');
  assert.match(css, /overflow-y:\s*auto/);
  assert.doesNotMatch(css, /linear-gradient/);
  assert.doesNotMatch(css, /#667eea|#764ba2/i);
});

test('default auth uses a cool neutral surface with distinct blue and orange accents', () => {
  const css = fs.readFileSync(path.join(root, 'src/components/Auth.css'), 'utf8');

  assert.match(css, /--bg-canvas:\s*#EDF3F6/);
  assert.match(css, /--bg-secondary:\s*#FFFFFF/);
  assert.match(css, /--border-focus:\s*#D97706/);
  assert.match(css, /background:\s*#263D5B/);
});

test('auth forms mirror server-side credential length limits', () => {
  const files = ['Login.jsx', 'Register.jsx', 'Setup.jsx', 'AdminConsole.jsx'];
  for (const filename of files) {
    const source = fs.readFileSync(path.join(root, 'src/components', filename), 'utf8');
    assert.match(source, /maxLength=\{128\}/, `${filename} must cap password input`);
  }
});

test('global motion can be disabled and typography does not use negative tracking', () => {
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /letter-spacing:\s*-/);
});

test('fonts are bundled locally without Google runtime requests', () => {
  const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const doodleCss = fs.readFileSync(path.join(root, 'src/DoodleTheme.css'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'src/index.jsx'), 'utf8');

  assert.doesNotMatch(`${indexCss}\n${doodleCss}`, /fonts\.googleapis\.com/);
  assert.match(entry, /@fontsource-variable\/fraunces/);
  assert.match(entry, /@fontsource-variable\/dm-sans/);
  assert.match(entry, /@fontsource\/delius-swash-caps/);
  assert.match(entry, /@fontsource-variable\/jetbrains-mono/);
});
