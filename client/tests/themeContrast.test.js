const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Nr. 27 (Top-30, 2026-09-13): Theme-Kontraste nach WCAG AA. Dark/OLED/E-Ink
// unterbotten AA mit --text-muted (2.47-4.48:1 statt 4.5:1), im Light-Theme
// lagen die Statusfarben unter der 3:1-Grenze von WCAG 1.4.11. Dieser Test
// rechnet die Verhältnisse aus den Theme-Blöcken selbst nach — künftig rutscht
// keine Token-Änderung unbemerkt unter AA, ganz ohne Augenmaß.
//
// Nachgerechnete Ist-Werte (auf bg-primary / bg-secondary / bg-tertiary):
//   light  --text-muted  #74644F  5.14 / 5.38 / 5.07   (unverändert, passt)
//   dark   --text-muted  #9C8F7E  5.61 / 5.13 / 4.52   (vorher #6E6458)
//   oled   --text-muted  #897D6E  5.22 / 4.95 / 4.65   (vorher #5C5448)
//   eink   --text-muted  #6B6B6B  5.33 / 5.02 / 4.68   (vorher #777777)
//   doodle --text-muted  #626B79  5.22 / 5.39 / 4.93   (vorher #6B7280)

const clientRoot = path.join(__dirname, '..');

function readClientFile(...parts) {
  return fs.readFileSync(path.join(clientRoot, ...parts), 'utf8');
}

/** Body des ersten Selektor-Blocks, der --bg-primary definiert (der erste
 *  :root-Block in index.css ist die Spacing-/Z-Index-Skala, nicht das Theme). */
function parseThemeBlock(source, selector) {
  let pos = 0;
  for (;;) {
    const start = source.indexOf(selector, pos);
    assert.ok(start !== -1, `Selektor ${selector} nicht gefunden`);
    const open = source.indexOf('{', start);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      i += 1;
    }
    const body = source.slice(open + 1, i - 1);
    const vars = {};
    for (const m of body.matchAll(/--([\w-]+):\s*#([0-9a-fA-F]{3,8})\s*;/g)) {
      vars[m[1]] = `#${m[2]}`;
    }
    if (vars['bg-primary']) return vars;
    pos = start + selector.length;
  }
}

const indexCss = readClientFile('src/index.css');
const doodleCss = readClientFile('src/DoodleTheme.css');

const themes = {
  light: parseThemeBlock(indexCss, ':root'),
  dark: parseThemeBlock(indexCss, 'body.dark-mode'),
  oled: parseThemeBlock(indexCss, 'body.oled-mode'),
  eink: parseThemeBlock(indexCss, 'body.eink-mode'),
  doodle: parseThemeBlock(doodleCss, 'body.doodle-mode'),
};

/** CSS-Vererbung nachbilden: definiert ein Theme-Block ein Token nicht, gilt
 *  der :root-Wert (OLED definiert z.B. keine eigenen Statusfarben und erbt
 *  die Light-Pastelle auf schwarzem Grund — das ist gewollt und lesbar). */
function resolveToken(theme, name) {
  return themes[theme][name] ?? themes.light[name] ?? null;
}

function relativeLuminance(hex) {
  const digits = hex.replace('#', '');
  const full = digits.length === 3 ? digits.split('').map((c) => c + c).join('') : digits;
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const [lighter, darker] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const BACKGROUNDS = ['bg-primary', 'bg-secondary', 'bg-tertiary'];
const NOTE_COLORS = [
  'note-white', 'note-red', 'note-orange', 'note-yellow', 'note-green', 'note-teal',
  'note-cyan', 'note-blue', 'note-purple', 'note-pink', 'note-brown', 'note-gray',
];
const THEMES = Object.keys(themes);

test('A-Regel: muted/tertiary/secondary erreichen AA (4.5:1) auf allen Flächen', () => {
  for (const theme of THEMES) {
    for (const token of ['text-muted', 'text-tertiary', 'text-secondary']) {
      const fg = resolveToken(theme, token);
      assert.ok(fg, `${theme}.${token} muss als Hex definiert oder geerbt sein`);
      for (const bg of BACKGROUNDS) {
        const ratio = contrastRatio(fg, resolveToken(theme, bg));
        assert.ok(
          ratio >= 4.5,
          `${theme}: --${token} ${fg} auf --${bg} ${resolveToken(theme, bg)} = ${ratio.toFixed(2)}:1 — WCAG AA verlangt 4.5:1 für Text`
        );
      }
    }
  }
});

test('B-Regel: Statusfarben erreichen 3:1 auf --bg-primary (WCAG 1.4.11)', () => {
  // Statusfarben tragen Bedeutung über Toast-Border/Icons und farbige Labels;
  // 3:1 ist die Grenze für nicht-textliche Bedeutungsträger bzw. großen Text.
  for (const theme of THEMES) {
    for (const token of ['success-color', 'warning-color', 'error-color', 'info-color']) {
      const fg = resolveToken(theme, token);
      assert.ok(fg, `${theme}.${token} muss als Hex definiert oder geerbt sein`);
      const ratio = contrastRatio(fg, resolveToken(theme, 'bg-primary'));
      assert.ok(
        ratio >= 3,
        `${theme}: --${token} ${fg} auf --bg-primary = ${ratio.toFixed(2)}:1 — WCAG 1.4.11 verlangt 3:1`
      );
    }
  }
});

test('C-Regel: Karten-Text (muted und primary) bleibt auf jeder Notizfarbe über 3:1', () => {
  // Die zwölf Notizhintergründe tragen den Karteninhalt UND die Action-Icons
  // (--text-muted). 3:1 ist die Untergrenze für bedeutungstragende Elemente;
  // echter Inhalt nutzt --text-primary und liegt damit deutlich höher.
  for (const theme of THEMES) {
    for (const noteColor of NOTE_COLORS) {
      const bg = resolveToken(theme, noteColor);
      assert.ok(bg, `${theme}.${noteColor} muss als Hex definiert sein`);
      for (const token of ['text-muted', 'text-primary']) {
        const ratio = contrastRatio(resolveToken(theme, token), bg);
        assert.ok(
          ratio >= 3,
          `${theme}: --${token} auf --${noteColor} ${bg} = ${ratio.toFixed(2)}:1 — nötig wären 3:1`
        );
      }
    }
  }
});

test('Hierarchie: die aufgehellten muted-Töne bleiben leiser als tertiary', () => {
  // Die Aufhellung (Nr. 27) darf die Ton-Hierarchie (tertiary > muted) nicht
  // ebnen, sonst verliert die Skala ihre Aussagekraft. Bewacht werden die vier
  // geänderten Themes — Light hat diese Ordnung historisch nicht (dort ist
  // muted longstanding lauter als tertiary, ein eigenständiger Design-Entscheid,
  // die dieser Fix bewusst nicht anfasst).
  for (const theme of ['dark', 'oled', 'eink', 'doodle']) {
    for (const bg of BACKGROUNDS) {
      const mutedRatio = contrastRatio(resolveToken(theme, 'text-muted'), resolveToken(theme, bg));
      const tertiaryRatio = contrastRatio(resolveToken(theme, 'text-tertiary'), resolveToken(theme, bg));
      assert.ok(
        mutedRatio < tertiaryRatio,
        `${theme}: --text-muted muss auf --${bg} leiser bleiben als --text-tertiary (${mutedRatio.toFixed(2)} vs. ${tertiaryRatio.toFixed(2)})`
      );
    }
  }
});

test('Nr. 27: die sechs korrigierten Tokens stehen exakt so im CSS', () => {
  // Regression-Nadeln: ein Revert der Aufhellungen (oder ein versehentliches
  // "Zurücksetzen" beim Theme-Pflegen) failt hier mit Namen, nicht erst
  // indirekt über die A-Regel.
  assert.equal(themes.dark['text-muted'], '#9C8F7E');
  assert.equal(themes.oled['text-muted'], '#897D6E');
  assert.equal(themes.eink['text-muted'], '#6B6B6B');
  assert.equal(themes.doodle['text-muted'], '#626B79');
  assert.equal(themes.light['success-color'], '#5F7D58');
  assert.equal(themes.light['warning-color'], '#A87B22');
  assert.equal(themes.light['info-color'], '#4F7591');
  assert.equal(themes.light['error-color'], '#9F3F3F');
});

test('Nr. 27: die *-light-Tints sind unangetastet (Warm-Paper-Look bleibt)', () => {
  // Die Tints sind Flächen (rgba-Überblendungen), kein Text — sie dürfen hell
  // bleiben. Der Parser oben nimmt bewusst nur Hex-Werte, deshalb hier direkt
  // gegen die Quelldatei: die ursprünglichen rgb-Basiswerte müssen weiter da sein.
  for (const [token, rgb] of [
    ['success-light', 'rgba(125, 155, 118, 0.15)'],
    ['warning-light', 'rgba(212, 168, 75, 0.15)'],
    ['info-light', 'rgba(123, 155, 181, 0.15)'],
  ]) {
    assert.match(indexCss, new RegExp(`--${token}:\\s*${rgb.replace(/[()]/g, '\\$&')}`), `--${token} sollte weiterhin ${rgb} sein`);
  }
});

test('Nr. 27: harte Kontrast-Fixes decken dark UND oled ab (keine Fallback-Falle)', () => {
  // Zwei reale axe-Funde ( lokal im 5-Theme-Scan gefunden): Das Sidebar-Badge
  // und der aktive Admin-Tab hatten nur .dark-mode-Präfixe — OLED fiel auf die
  // Light-Regel zurück (#7a4030 auf fast schwarz = 1.36:1). Diese Guards
  // pinnen, dass die dunklen Varianten beide Themes adressieren; die Verhältnisse
  // selbst misst der axe-Lauf im E2E über alle fünf Themes.
  const sidebar = readClientFile('src/components/Sidebar.css');
  const sidebarDark = sidebar.match(/\.dark-mode \.sidebar-item:hover \.count,[\s\S]*?color: (#\w+);/);
  assert.ok(sidebarDark, 'dunkle Badge-Regel muss existieren');
  assert.equal(sidebarDark[1], '#F0B98D');
  assert.match(sidebar, /\.oled-mode \.sidebar-item:hover \.count,/);
  assert.match(sidebar, /\.oled-mode \.sidebar-item\.active \.count\s*[,{]/);
  assert.match(sidebar, /color: #733c2d;/);

  const admin = readClientFile('src/components/AdminConsole.css');
  assert.match(admin, /\.admin-tab\.active\s*\{\s*\/\*[\s\S]*?color: #4a5fd0;/);
  assert.match(admin, /\.dark-mode \.admin-tab\.active,\s*\n\s*\.oled-mode \.admin-tab\.active\s*\{\s*[\s\S]*?color: #8b9cf5;/);
});
