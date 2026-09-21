const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 11): Jede /uploads/images/*-Anfrage suchte die
// Notiz über `images.filename` bzw. `images.thumbnailFilename` — beide Felder
// waren nicht indexiert, also blieb MongoDB nur ein COLLSCAN über die
// instanzweite notes-Collection. Eine Wand mit 30 Bildnotizen bedeutete 30-60
// Vollscans pro Rendering, auf derselben Maschine wie mongod.
//
// Dieser Test ist bewusst als Guard gebaut: Er liest die abgefragten Felder aus
// dem Middleware-Quelltext und verlangt für jedes einen Index. Damit wird
// „Query-Feld ohne Index" zur Build-Bremse, statt beim nächsten Umbau still
// zurückzukehren.

const Note = require('../models/Note');
const secureFileServe = fs.readFileSync(path.join(__dirname, '../middleware/secureFileServe.js'), 'utf8');

const schemaIndexes = Note.schema.indexes();
const indexedFields = new Set(schemaIndexes.flatMap(([keys]) => Object.keys(keys)));

/** Felder, die die Datei-Auslieferung per Query anspricht. */
function queriedImageFields() {
  const fields = new Set();
  // v1.12.0: files.filename dazu — /uploads/files/* sucht die Notiz auf
  // demselben Weg, braucht also denselben COLLSCAN-Schutz.
  for (const match of secureFileServe.matchAll(/'((?:images|files|todoItems)\.[A-Za-z.]+)'/g)) {
    fields.add(match[1]);
  }
  return [...fields];
}

test('the image lookup fields are indexed', () => {
  const fields = queriedImageFields();
  assert.deepEqual(fields.sort(), ['files.filename', 'images.filename', 'images.thumbnailFilename'],
    'the guard must follow the middleware: adjust this list when the query changes');

  for (const field of fields) {
    assert.ok(indexedFields.has(field), `${field} is queried by secureFileServe but has no index (COLLSCAN)`);
  }
});

test('the image indexes are multikey and deliberately not unique', () => {
  for (const [keys, options] of schemaIndexes) {
    const isImageIndex = Object.keys(keys).some((field) => field.startsWith('images.'));
    if (!isImageIndex) continue;
    assert.notEqual(options.unique, true,
      'a failed unique build on existing data would make syncIndexes() reject and kill startup before app.listen()');
    assert.equal(keys[Object.keys(keys)[0]], 1, 'ascending is enough for an equality lookup');
  }
  assert.ok(schemaIndexes.some(([keys]) => keys['images.filename'] === 1));
  assert.ok(schemaIndexes.some(([keys]) => keys['images.thumbnailFilename'] === 1));
});

test('no array-field index in the schema is unique', () => {
  // Derselbe Startup-Fehlerklasse wie oben: ein Unique-Index auf einem
  // Array-Feld schlägt bei doppelten Werten in Bestandsdaten fehl.
  const arrayPaths = ['images.filename', 'images.thumbnailFilename', 'files.filename', 'tags', 'sharedWith', 'todoItems.text'];
  for (const [keys, options] of schemaIndexes) {
    for (const field of Object.keys(keys)) {
      if (arrayPaths.includes(field)) {
        assert.notEqual(options.unique, true, `${field} is an array field and must not carry a unique index`);
      }
    }
  }
});

test('the upgrade boot check asserts the new indexes on a real database', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/verify-upgrade-boot.js'), 'utf8');
  assert.match(script, /images\.filename_1/);
  assert.match(script, /images\.thumbnailFilename_1/);
  assert.match(script, /image serving must not scan/);
});
