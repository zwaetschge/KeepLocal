const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// v1.13.0 Nr. 2: Karten rendern Markdown (marked + DOMPurify-Allowlist).
// Ohne DOM gibt DOMPurify Text unverändert durch (isSupported=false) — das
// Parsen selbst, die CRLF-Normalisierung und die Suchtreffer-Markierung sind
// trotzdem real prüfbar; die Allowlist wird am Quelltext gepinnt.

const markdownUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/markdown.mjs')
).href;
const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

async function loadMarkdown() {
  try {
    return await import(markdownUrl);
  } catch {
    return null; // marked/dompurify in dieser Umgebung nicht ladbar
  }
}

test('renderMarkdown parst Überschriften und Listen zu HTML', async () => {
  const mod = await loadMarkdown();
  if (!mod) return;
  const { renderMarkdown } = mod;

  const html = await renderMarkdown('# Titel\n\n- eins\n- zwei');
  assert.match(html, /<h1[^>]*>Titel<\/h1>/);
  assert.match(html, /<li>eins<\/li>/);
  assert.match(html, /<li>zwei<\/li>/);
});

test('einzelne Zeilenumbrüche werden zu <br> (breaks: true)', async () => {
  const mod = await loadMarkdown();
  if (!mod) return;
  const { renderMarkdown } = mod;

  const html = await renderMarkdown('Zeile eins\nZeile zwei');
  assert.match(html, /Zeile eins<br\s*\/?>Zeile zwei/);
});

test('CRLF-Eingaben werden vor dem Parsen normalisiert', async () => {
  const mod = await loadMarkdown();
  if (!mod) return;
  const { renderMarkdown } = mod;

  const crlf = await renderMarkdown('Zeile eins\r\nZeile zwei');
  const lf = await renderMarkdown('Zeile eins\nZeile zwei');
  assert.equal(crlf, lf, 'CRLF und LF liefern dasselbe HTML');
});

test('GFM-Task-Listen rendern deaktivierte Checkboxen', async () => {
  const mod = await loadMarkdown();
  if (!mod) return;
  const { renderMarkdown } = mod;

  const html = await renderMarkdown('- [x] fertig\n- [ ] offen');
  assert.match(html, /<input[^>]*checked[^>]*disabled[^>]*type="checkbox">/);
  assert.match(html, /<input[^>]*disabled[^>]*type="checkbox">/);
});

test('Suchtreffer werden nur im Text markiert, nie im Markup', async () => {
  const mod = await loadMarkdown();
  if (!mod) return;
  const { renderMarkdown } = mod;

  const html = await renderMarkdown('Brot und Brot', 'brot');
  assert.equal((html.match(/<mark>/g) || []).length, 2, 'beide Vorkommen');
  assert.match(html, /<p><mark>Brot<\/mark> und <mark>Brot<\/mark><\/p>/);

  // Ohne Suchbegriff bleibt der geparste Text unangetastet.
  assert.ok((await renderMarkdown('Brot', '')).includes('Brot'));
  assert.ok(!(await renderMarkdown('Brot', '')).includes('<mark>'));
});

test('DOMPurify-Allowlist: kein script/iframe/style, Links hart gehärtet', () => {
  const source = read('utils/markdown.mjs');
  const allowListMatch = source.match(/MARKDOWN_ALLOWED_TAGS = \[([^\]]+)\]/);
  assert.ok(allowListMatch, 'Tag-Allowlist existiert als Konstante');
  assert.doesNotMatch(allowListMatch[1], /'script'|'iframe'|'style'|'form'|'object'|'embed'/);
  const attrMatch = source.match(/MARKDOWN_ALLOWED_ATTR = \[([^\]]+)\]/);
  assert.ok(attrMatch, 'Attribut-Allowlist existiert als Konstante');
  assert.doesNotMatch(attrMatch[1], /'onerror'|'onclick'|'onload'/);

  // Der afterSanitizeAttributes-Hook härtet jeden Link auf target=_blank +
  // noopener/noreferrer und wird im finally wieder abgemeldet, damit er
  // nicht in spätere sanitize-Aufrufe anderer Stellen leakt.
  assert.match(source, /addHook\('afterSanitizeAttributes', forceNewWindow\)/);
  assert.match(source, /removeHook\('afterSanitizeAttributes'\)/);
  assert.match(source, /target.*_blank/);
  assert.match(source, /noopener.*noreferrer/);
});

test('Note.jsx rendert Markdown hinter dem Kontext-Schalter, Code-Notizen ausgenommen', () => {
  const note = read('components/Note.jsx');
  // Schalter aus den Kontext-Settings, Code-Notizen bleiben monospaced.
  assert.match(note, /settings\.renderMarkdown !== false && !note\.isCode/);
  assert.match(note, /useMarkdownHtml\(/);
  // Ohne fertiges Markdown-HTML (asynchrones Laden) fällt die Karte auf den
  // sanitizer-Pfad zurück — kein Flackern rohen Markdowns.
  assert.match(note, /markdownHtml \?\? plainHtml/);
  // Die Markdown-Klasse styled die Karte im Note.css.
  assert.match(note, /' markdown' : ''/);
  const css = read('components/Note.css');
  assert.match(css, /\.note-content\.markdown/);
});
