const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');

function readClientFile(...parts) {
  return fs.readFileSync(path.join(clientRoot, ...parts), 'utf8');
}

test('theme cycle includes doodle mode after e-ink and applies the body class', () => {
  const app = readClientFile('src/App.jsx');

  assert.match(app, /readLocalStorage\('theme'\)/);
  assert.match(app, /THEMES\.has\(savedTheme\) \? savedTheme : 'light'/);
  assert.match(app, /classList\.remove\('dark-mode', 'oled-mode', 'eink-mode', 'doodle-mode'\)/);
  assert.match(app, /theme === 'doodle'/);
  assert.match(app, /classList\.add\('doodle-mode'\)/);
  assert.match(app, /prevTheme === 'eink'\) return 'doodle'/);
  assert.match(app, /prevTheme === 'doodle'\) return 'light'/);
});

test('theme toggle exposes doodle as a first-class selectable theme', () => {
  const toggle = readClientFile('src/components/ThemeToggle.jsx');
  const en = readClientFile('src/translations/en.js');
  const de = readClientFile('src/translations/de.js');

  assert.match(toggle, /theme === 'doodle'/);
  assert.match(toggle, /return '✏️'/);
  assert.match(toggle, /theme === 'eink'\) return t\('switchToDoodleMode'\)/);
  assert.match(toggle, /theme === 'doodle'\) return t\('switchToLightMode'\)/);
  assert.match(en, /switchToDoodleMode:\s*'Switch to Doodle mode'/);
  assert.match(de, /switchToDoodleMode:\s*'Zum Doodle-Modus wechseln'/);
});

test('doodle theme defines accessible doodle tokens and handwritten typography', () => {
  const css = readClientFile('src/DoodleTheme.css');
  const app = readClientFile('src/App.jsx');
  const entry = readClientFile('src/index.jsx');

  assert.match(entry, /@fontsource\/delius-swash-caps/);
  assert.match(entry, /@fontsource-variable\/jetbrains-mono/);
  assert.match(app, /import '\.\/DoodleTheme\.css'/);
  assert.match(css, /body\.doodle-mode\s*\{/);
  assert.match(css, /--font-display:\s*'Delius Swash Caps'/);
  assert.match(css, /--font-body:\s*'Delius Swash Caps'/);
  assert.match(css, /--font-mono:\s*'JetBrains Mono Variable'/);
  assert.match(css, /--text-primary:\s*#111827/);
  assert.match(css, /--border-focus:\s*#49B6E5/);
  assert.match(css, /--accent-color:\s*#263D5B/);
  assert.match(css, /--success-color:\s*#16A34A/);
  assert.match(css, /--warning-color:\s*#D97706/);
  assert.match(css, /--error-color:\s*#DC2626/);
  assert.match(css, /body\.doodle-mode \.note/);
  assert.match(css, /box-shadow:\s*4px 4px 0/);
  assert.match(css, /body\.doodle-mode::before/);
  assert.match(css, /\.doodle-mode \.App-header::after/);
});
