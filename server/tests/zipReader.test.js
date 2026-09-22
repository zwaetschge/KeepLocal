const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

// v1.15.0: Dekompressions-Bomben im ZIP-Reader. Vorher wurde die deklarierte
// uncompressedSize des Zentraleintrags erst NACH dem inflate geprueft — ein
// manipuliertes Archiv (4 GB aus 4 KB, "60 Tage Ruhe"-Klasse) fuellte erst den
// RAM und wurde dann per Groessen-/CRC-Vergleich abgewiesen. Jetzt: Deklaration
// wird VOR dem Entpacken gegen 25 MB/Entry und 512 MB gesamt geprueft, und
// inflateRawSync bekommt zusaetzlich maxOutputLength als harte Grenze, die
// auch eine kleine (gelogene) Deklaration nicht uebertuenzeln kann.
//
// Der eigene Writer (utils/zipWriter) schreibt nur STORE und immer die Wahrheit
// — fuer Boese-Archive gibt es unten den Roh-Bauer, mit dem sich gezielt Felder
// des Zentraleintrags luegen lassen. Limits sind im Reader nicht exportiert;
// die Kopien hier pinnen die Werte (Aenderung → Test rot).

const { readZipEntries } = require('../utils/zipReader');
const { ZipWriter, crc32 } = require('../utils/zipWriter');

const MAX_ENTRY = 25 * 1024 * 1024;   // 26214400 — Deckelung pro Eintrag
const MAX_TOTAL = 512 * 1024 * 1024;  // 536870912 — kumulatives Budget

// 25 MiB Nullen: der groesste legitime Eintrag (PDF-Anhang-Limit), deflate-
// echt auf ein paar KB. Einmal vorab gebaut, testen Grenze (inklusiv) und
// Gesamtbudget damit.
const NULL_BIG = Buffer.alloc(MAX_ENTRY, 0);
const NULL_BIG_DEFLATED = zlib.deflateRawSync(NULL_BIG);
const NULL_BIG_CRC = crc32(NULL_BIG);

// 64 MiB Nullen deflaten auf ~65 KB — der Kern einer klassischen Ratio-Bombe.
// CRC und Payload einmal vorab; die 64 MiB selbst bleiben nicht liegen.
const BOMB_DEFLATED = zlib.deflateRawSync(Buffer.alloc(64 * 1024 * 1024, 0));
const BOMB_CRC = crc32(Buffer.alloc(64 * 1024 * 1024, 0));

/**
 * Roh-ZIP-Bauer fuer manipulierte Archive, Feldlayout exakt wie
 * utils/zipWriter.js (lokale Header, Central Directory, EOCD). Der Unterschied:
 * `declaredSize` landet UNGEPRUEFT als uncompressedSize im Zentraleintrag —
 * genau die Stelle, an der ein Archiv-Autor luegen kann.
 * @param {Array<{name: string, method?: number, data: Buffer, declaredSize: number, crc: number}>} entries
 */
function buildRawZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);           // signature
    local.writeUInt16LE(20, 4);                   // version needed
    local.writeUInt16LE(0x0800, 6);               // flags: UTF-8 names
    local.writeUInt16LE(entry.method ?? 0, 8);    // method
    local.writeUInt16LE(0, 10);                   // mod time
    local.writeUInt16LE(0x21, 12);                // mod date (1980-01-01, valide DOS-Zeit)
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);   // compressed — hier ehrlich
    local.writeUInt32LE(entry.declaredSize, 22);  // uncompressed — gelogen wie zentral
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);                   // extra length
    parts.push(local, nameBuffer, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);             // signature
    dir.writeUInt16LE(20, 4);                     // version made by
    dir.writeUInt16LE(20, 6);                     // version needed
    dir.writeUInt16LE(0x0800, 8);                 // flags: UTF-8
    dir.writeUInt16LE(entry.method ?? 0, 10);     // method — das vom Reader gelesene Feld
    dir.writeUInt16LE(0, 12);                     // mod time
    dir.writeUInt16LE(0x21, 14);                  // mod date
    dir.writeUInt32LE(entry.crc, 16);
    dir.writeUInt32LE(entry.data.length, 20);     // compressed — ehrlich
    dir.writeUInt32LE(entry.declaredSize, 24);    // uncompressed — DIE Manipulationsstelle
    dir.writeUInt16LE(nameBuffer.length, 28);
    dir.writeUInt16LE(0, 30);                     // extra
    dir.writeUInt16LE(0, 32);                     // comment
    dir.writeUInt16LE(0, 34);                     // disk number
    dir.writeUInt16LE(0, 36);                     // internal attrs
    dir.writeUInt32LE(0, 38);                     // external attrs
    dir.writeUInt32LE(offset, 42);                // local header offset
    central.push(dir, nameBuffer);

    offset += 30 + nameBuffer.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                       // disk number
  eocd.writeUInt16LE(0, 6);                       // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);                 // central dir offset
  eocd.writeUInt16LE(0, 20);                      // comment length

  return Buffer.concat([...parts, centralBuffer, eocd]);
}

test('Normale Archive (eigener STORE-Writer, fremdes DEFLATE) werden vollstaendig gelesen', () => {
  // Eigener Export-Weg: STORE, korrekte Groessen, UTF-8-Namen — der
  // Regressionsschirm dafuer, dass die neuen Limits den Normalfall nicht streifen.
  const zip = new ZipWriter();
  zip.add('notizen/erste.md', '# Erste\n\nText');
  zip.add('assets/manifest.json', '{"files":[]}');
  const stored = readZipEntries(zip.finish());
  assert.ok(stored instanceof Map);
  assert.deepEqual([...stored.keys()].sort(), ['assets/manifest.json', 'notizen/erste.md']);
  assert.equal(stored.get('notizen/erste.md').toString('utf8'), '# Erste\n\nText');
  assert.equal(stored.get('assets/manifest.json').toString('utf8'), '{"files":[]}');

  // Fremder Packer (Obsidian/Trilium): DEFLATE ueber den Roh-Bauer.
  const inner = Buffer.from('# Deflate-Inhalt\n');
  const deflated = readZipEntries(buildRawZip([
    { name: 'ordner/fremd.md', method: 8, data: zlib.deflateRawSync(inner), declaredSize: inner.length, crc: crc32(inner) }
  ]));
  assert.deepEqual([...deflated.keys()], ['ordner/fremd.md']);
  assert.equal(deflated.get('ordner/fremd.md').toString('utf8'), '# Deflate-Inhalt\n');
});

test('Grenze ist inklusiv: genau 25 MB in einem Eintrag bleiben lesbar', () => {
  // Der legitime Gegenpol: PDF-Anhaenge bis zum Limit muessen weiter
  // importieren — nur DRUEBER wird abgelehnt (der Reader prueft auf >).
  const archive = buildRawZip([
    { name: 'gross-aber-legal.pdf', method: 8, data: NULL_BIG_DEFLATED, declaredSize: MAX_ENTRY, crc: NULL_BIG_CRC }
  ]);
  const entries = readZipEntries(archive);
  assert.equal(entries.size, 1);
  assert.equal(entries.get('gross-aber-legal.pdf').length, MAX_ENTRY);
  assert.ok(entries.get('gross-aber-legal.pdf').equals(NULL_BIG), 'Inhalt byte-identisch entpackt');
});

test('Deklarierte uncompressedSize ueber 25 MB wird VOR dem Entpacken abgelehnt', () => {
  // Der Payload selbst ware voellig harmlos (12 Bytes) — wuerde der Reader
  // erst entpacken und dann vergleichen, kaeme "Groesse passt nicht". Dass
  // stattdessen die Groessen-Meldung faellt, beweist: die Deklaration wird
  // vorher geprueft.
  const inner = Buffer.from('schoen klein');
  const archive = buildRawZip([
    { name: 'lies-gross.bin', method: 8, data: zlib.deflateRawSync(inner), declaredSize: 26 * 1024 * 1024, crc: crc32(inner) }
  ]);
  assert.throws(() => readZipEntries(archive), (error) => {
    assert.equal(error.message, 'Eintrag zu gross nach Dekompression (27262976 Bytes): lies-gross.bin');
    return true;
  });
});

test('Gesamtbudget: 20 Eintraege a 25 MB gehen, der 21. sprengt die 512 MB', () => {
  // Jeder Eintrag ist einzeln legal (ehrlich deklarierte 25 MB) — der Angriff
  // ist die Summe: 20 x 25 MiB = 500 MiB verarbeitet, der naechste waere 525
  // MiB > 512 MiB Budget. Compressed ist der ganze Angriff nur ~0,5 MB auf
  // der Leitung — genau die Diskrepanz, gegen die das Budget existiert.
  const entries = [];
  for (let i = 1; i <= 21; i += 1) {
    entries.push({
      name: `nullen-${String(i).padStart(2, '0')}.bin`,
      method: 8,
      data: NULL_BIG_DEFLATED,
      declaredSize: MAX_ENTRY,
      crc: NULL_BIG_CRC
    });
  }
  assert.throws(() => readZipEntries(buildRawZip(entries)), (error) => {
    assert.equal(error.message, 'Archiv ueberschreitet das Gesamtbudget entpackter Daten: nullen-21.bin');
    return true;
  });
});

test('Ratio-Bombe: kleine Deklaration rettet nichts — maxOutputLength stoppt das inflate', () => {
  // 64 MiB Nullen aus ~65 KB Compressed, der Zentraleintrag luegt sich mit
  // 1024 deklarierten Bytes an beiden Groessen-Checks vorbei. Vor der
  // Harteung lief das inflate hier komplett durch (64 MB RAM fuer nichts),
  // erst der anschliessende Vergleich haette gemeckert. Jetzt bricht zlib mit
  // ERR_BUFFER_TOO_LARGE ab und der Reader wickelt es in seine Meldung ein.
  const archive = buildRawZip([
    { name: 'bombe.bin', method: 8, data: BOMB_DEFLATED, declaredSize: 1024, crc: BOMB_CRC }
  ]);
  assert.throws(() => readZipEntries(archive), (error) => {
    assert.ok(
      error.message.startsWith(
        'Eintrag liess sich nicht entpacken (evtl. Dekompressions-Limit 26214400 Bytes ueberschritten): bombe.bin ('
      ),
      `unerwartete Meldung: ${error.message}`
    );
    // Der innere zlib-Satz haengt hinten an — nur sein Kern, nicht die ganze
    // Node-Versionsspezifische Formulierung, wird festgenagelt.
    assert.match(error.message, /Cannot create a Buffer larger than 26214400 bytes\)$/);
    return true;
  });
});

test('STORE-Eintrag mit gelogener uncompressedSize wird VOR der Datenkopie abgelehnt (Review v1.15.0)', () => {
  // Der Roh-Bauer schreibt compressedSize ehrlich (data.length) und nur die
  // uncompressedSize gelogen. Vor dem Fix lief eine Deklaration von 1 Byte
  // durch beide Limits, bevor Buffer.from(rawData) die volle Datenmenge in
  // den Speicher kopierte — bis Archivgroesse, also bis zum 512-MB-Multer-
  // Limit. STORE ohne Kompression muss beide Groessen gleich deklarieren.
  const big = Buffer.alloc(300 * 1024, 0x41);
  assert.throws(() => readZipEntries(buildRawZip([
    { name: 'falle.bin', method: 0, data: big, declaredSize: 1, crc: crc32(big) }
  ])), /widersprüchliche Größen/);

  // Ehrlicher STORE (beide Groessen gleich) bleibt selbstveraestandlich lesbar.
  const content = Buffer.from('# ehrlich\n');
  const honest = readZipEntries(buildRawZip([
    { name: 'ehrlich.md', method: 0, data: content, declaredSize: content.length, crc: crc32(content) }
  ]));
  assert.equal(honest.get('ehrlich.md').toString('utf8'), '# ehrlich\n');
});
