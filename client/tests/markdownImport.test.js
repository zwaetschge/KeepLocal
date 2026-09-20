const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// v1.10.1: Reine Import-Vorbereitung für den Bulk-Endpoint. Die Helfer leben
// im utils-Modul, damit Settings.jsx nur noch Verdrahtung ist.

const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/markdownImport.mjs')).href;

const file = (name, webkitRelativePath, content = '', size = content.length) => ({
  name,
  webkitRelativePath,
  size,
  text: async () => content
});

test('buildMarkdownImportItems filtert Binärdateien und Übertreiber', async () => {
  const { buildMarkdownImportItems, IMPORT_MAX_FILE_BYTES } = await import(moduleUrl);

  const { items, skipped } = await buildMarkdownImportItems([
    file('a.md', 'root/a.md', 'ok'),
    file('bild.png', 'root/bild.png', 'binary'),
    file('zu-gross.md', 'root/zu-gross.md', 'x', IMPORT_MAX_FILE_BYTES + 1),
    file('notiz.txt', 'root/notiz.txt', 'textdatei')
  ]);

  assert.deepEqual(items.map(item => item.title), ['a', 'notiz']);
  assert.equal(skipped, 2, 'png + übergroß');
  assert.equal(items[1].content, 'textdatei');
});

test('buildMarkdownImportItems baut Ordnerpfade und sortiert Eltern vor Kindern', async () => {
  const { buildMarkdownImportItems } = await import(moduleUrl);

  const { items } = await buildMarkdownImportItems([
    file('kind.md', 'Projekte/KeepLocal/kind.md', 'tief'),
    file('wurzel.md', 'wurzel.md', 'oben'),
    file('mittel.md', 'Projekte/mittel.md', 'mitte')
  ]);

  // localeCompare (ICU, primaer case-insensitive): KeepLocal < mittel < wurzel
  assert.deepEqual(items.map(item => item.path), ['Projekte/KeepLocal', 'Projekte', '']);
  assert.equal(items[2].title, 'wurzel');
});

test('index.md/_index.md: erste Überschrift wird Titel, sonst Ordnername', async () => {
  const { buildMarkdownImportItems } = await import(moduleUrl);

  const { items } = await buildMarkdownImportItems([
    file('index.md', 'Rezepte/index.md', '# Woche\neinkäufen'),
    file('_index.md', 'Ohne/Titel/_index.md', 'kein heading'),
    file('index.md', 'leer/index.md', '')
  ]);

  const byPath = Object.fromEntries(items.map(item => [item.path || `?${item.title}`, item]));
  assert.equal(byPath['Rezepte'].title, 'Woche');
  assert.equal(byPath['Ohne/Titel'].title, 'Titel', 'Fallback: letzter Pfad-Segment (Eltern-Ordner)');
  assert.equal(byPath['leer'].title, 'leer', 'Fallback: Ordnername bei leerer Datei');
});

test('Content wird auf 10k gekappt, Titel auf 200', async () => {
  const { buildMarkdownImportItems, IMPORT_MAX_CONTENT_CHARS } = await import(moduleUrl);

  const longContent = 'y'.repeat(IMPORT_MAX_CONTENT_CHARS + 500);
  const longName = 'n'.repeat(300);
  const { items } = await buildMarkdownImportItems([
    file(`${longName}.md`, `${longName}.md`, longContent)
  ]);

  assert.equal(items[0].content.length, IMPORT_MAX_CONTENT_CHARS);
  assert.equal(items[0].title.length, 200);
});

test('chunkImportItems teilt an der Servergrenze und toleriert kaputte Größen', async () => {
  const { chunkImportItems, IMPORT_CHUNK_SIZE } = await import(moduleUrl);
  const items = Array.from({ length: IMPORT_CHUNK_SIZE + 1 }, (_, index) => ({ title: `n${index}` }));

  const chunks = chunkImportItems(items);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, IMPORT_CHUNK_SIZE);
  assert.equal(chunks[1].length, 1);

  assert.deepEqual(chunkImportItems([]), []);
  assert.equal(chunkImportItems(items, 0).length, 2, 'ungültige Größe fällt auf den Default');
});
