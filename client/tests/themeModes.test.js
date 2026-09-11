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
  const browserEnvironment = readClientFile('src/utils/browserEnvironment.mjs');
  const settingsContext = readClientFile('src/contexts/SettingsContext.jsx');
  const payload = readClientFile('src/utils/settingsPayload.mjs');

  // Improvement #6: the theme is an account preference now, so App.jsx only
  // reads it from the SettingsContext and applies it to the document.
  assert.match(app, /const \{ settings, setTheme \} = useSettings\(\);/);
  assert.match(app, /const theme = settings\.theme;/);
  assert.match(app, /applyThemeToDocument\(theme\)/);
  assert.doesNotMatch(app, /readLocalStorage\('theme'\)/);

  assert.match(browserEnvironment, /'dark-mode', 'oled-mode', 'eink-mode', 'doodle-mode'/);
  assert.match(browserEnvironment, /doodle:\s*'doodle-mode'/);
  assert.match(browserEnvironment, /classList\.remove\(\.\.\.THEME_CLASSES\)/);
  assert.match(browserEnvironment, /classList\.add\(themeClass\)/);

  // Cycle order stays light -> dark -> oled -> eink -> doodle -> light.
  assert.match(app, /\{ light: 'dark', dark: 'oled', oled: 'eink', eink: 'doodle', doodle: 'light' \}/);
  assert.match(payload, /THEMES = \['light', 'dark', 'oled', 'eink', 'doodle'\]/);

  // Older installs stored the theme under its own localStorage key.
  assert.match(settingsContext, /LEGACY_THEME_KEY = 'theme'/);
  assert.match(settingsContext, /readLocalStorage\(LEGACY_THEME_KEY\)/);
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
