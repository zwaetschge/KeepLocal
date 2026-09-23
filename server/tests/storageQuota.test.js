const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Speicher-Quota pro Nutzer (v1.16.0): Bis v1.15 gab es nur Per-File-Limits —
// kumuliert konnte ein Konto/Write-Key das Volume füllen, auf dem im
// All-in-One-Image auch mongod und die Backups liegen. UPLOAD_QUOTA_MB deckelt
// die Summe aller Anhang-Bytes; 0/ungesetzt = aus (bestehende Installationen
// verhalten sich nach dem Upgrade exakt wie zuvor).

const noteModelPath = require.resolve('../models/Note');
const quotaPath = require.resolve('../utils/storageQuota');

const OWNER_ID = '507f191e810c19729de860ea';

function loadQuota({ aggregate = async () => [] } = {}) {
  delete require.cache[quotaPath];
  require.cache[noteModelPath] = {
    id: noteModelPath, filename: noteModelPath, loaded: true,
    exports: { aggregate }
  };
  return require(quotaPath);
}

test('quotaLimitBytes parses UPLOAD_QUOTA_MB and defaults to off', () => {
  const { quotaLimitBytes } = loadQuota();
  const original = process.env.UPLOAD_QUOTA_MB;

  try {
    process.env.UPLOAD_QUOTA_MB = '512';
    assert.equal(quotaLimitBytes(), 512 * 1024 * 1024);

    process.env.UPLOAD_QUOTA_MB = '0.5';
    assert.equal(quotaLimitBytes(), Math.floor(0.5 * 1024 * 1024));

    for (const invalid of ['', 'abc', '0', '-5']) {
      process.env.UPLOAD_QUOTA_MB = invalid;
      assert.equal(quotaLimitBytes(), 0, `${JSON.stringify(invalid)} muss die Quota abschalten`);
    }

    delete process.env.UPLOAD_QUOTA_MB;
    assert.equal(quotaLimitBytes(), 0, 'ohne Env ist die Quota aus');
  } finally {
    if (original === undefined) delete process.env.UPLOAD_QUOTA_MB;
    else process.env.UPLOAD_QUOTA_MB = original;
  }
});

test('getStorageUsage sums files+images over ALL notes including the trash', async () => {
  const seen = [];
  const { getStorageUsage } = loadQuota({
    aggregate: async (pipeline) => {
      seen.push(pipeline);
      return [{ _id: null, bytes: 4096 }];
    }
  });

  const bytes = await getStorageUsage(OWNER_ID);

  assert.equal(bytes, 4096);
  // Papierkorb zählt mit: Dateien überleben das Soft-Delete bis zum Purge —
  // ein $match auf deletedAt: null wäre ein Einzeiler-Bypass der Quota.
  assert.deepEqual(seen[0][0].$match, { userId: OWNER_ID });
  // Die Aggregation projiziert nur die Größen-Felder, kein Dokument-Material.
  assert.deepEqual(seen[0][1].$project, { files: 1, images: 1 });
  // Beide Größen-Felder sind $ifNull-abgesichert (Bestand vor v1.16 hat kein
  // images.size).
  const json = JSON.stringify(seen[0][2]);
  assert.match(json, /\$ifNull/, 'Fehlende size-Felder zählen als 0');

  // Leeres Ergebnis (keine Notizen) ist 0, kein undefined.
  const { getStorageUsage: emptyUsage } = loadQuota({ aggregate: async () => [] });
  assert.equal(await emptyUsage(OWNER_ID), 0);
});

test('assertStorageQuota throws 413 STORAGE_QUOTA_EXCEEDED beyond the limit', async () => {
  const oneMb = 1024 * 1024;
  const original = process.env.UPLOAD_QUOTA_MB;
  let usage = 0;
  const quota = loadQuota({
    aggregate: async () => [{ _id: null, bytes: usage }]
  });

  try {
    process.env.UPLOAD_QUOTA_MB = '1';

    usage = oneMb - 100;
    const ok = await quota.assertStorageQuota(OWNER_ID, 100);
    assert.equal(ok.enforced, true);
    assert.equal(ok.usedBytes, oneMb - 100);

    usage = oneMb - 100;
    await assert.rejects(
      quota.assertStorageQuota(OWNER_ID, 101),
      (error) => {
        assert.equal(error.statusCode, 413);
        assert.equal(error.code, 'STORAGE_QUOTA_EXCEEDED');
        assert.match(error.message, /Speicher-Budget/);
        return true;
      }
    );

    // additionalBytes <= 0 ist ein reiner Lesezugriff, kein Fehler.
    usage = oneMb * 2;
    const info = await quota.assertStorageQuota(OWNER_ID, 0);
    assert.equal(info.usedBytes, oneMb * 2, 'ohne zusätzliche Bytes wird nicht abgelehnt');
  } finally {
    if (original === undefined) delete process.env.UPLOAD_QUOTA_MB;
    else process.env.UPLOAD_QUOTA_MB = original;
  }
});

test('an unconfigured quota never touches the database', async () => {
  const original = process.env.UPLOAD_QUOTA_MB;
  let aggregated = false;
  const quota = loadQuota({
    aggregate: async () => { aggregated = true; return [{ _id: null, bytes: 5 }]; }
  });

  try {
    delete process.env.UPLOAD_QUOTA_MB;
    const result = await quota.assertStorageQuota(OWNER_ID, 10 * 1024 * 1024);
    assert.equal(result.enforced, false);
    assert.equal(aggregated, false, 'ohne Limit darf keine Aggregation laufen');
  } finally {
    if (original === undefined) delete process.env.UPLOAD_QUOTA_MB;
    else process.env.UPLOAD_QUOTA_MB = original;
  }
});

// Verdrahtung der drei Schreib-Pfade (Quota, die nirgends geprüft wird, schützt
// nichts) — gleiche Source-Pin-Technik wie fileAttachments.test.js:
test('quota is enforced on both upload handlers and the ZIP import', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../utils/attachmentUpload.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../services/notesService.js'), 'utf8');
  const noteModel = fs.readFileSync(path.join(__dirname, '../models/Note.js'), 'utf8');

  // Beide Handler prüfen die Summe der Batch-Bytes …
  const imageHandler = pipeline.slice(pipeline.indexOf('async function handleImageUpload'));
  const fileHandler = pipeline.slice(pipeline.indexOf('async function handleFileUpload'));
  assert.match(imageHandler, /assertStorageQuota\(/);
  assert.match(fileHandler, /assertStorageQuota\(/);
  // … und der Quota-Fehler trägt seinen Code durch die catch-Blöcke.
  assert.match(pipeline, /error\.code \? \{ code: error\.code \} : \{\}/);

  // Der ZIP-Import plant die Asset-Bytes, bevor die erste Datei geschrieben wird.
  const zipImport = service.slice(service.indexOf('async function importMarkdownZip'));
  const quotaAt = zipImport.indexOf('assertStorageQuota');
  const firstWriteAt = zipImport.indexOf('writeFileSync');
  assert.ok(quotaAt > -1 && quotaAt < firstWriteAt, 'Quota-Check muss vor dem ersten Schreiben stehen');

  // Die Bild-Metadaten tragen ihre Größe — ohne die ist die Quota für den
  // wichtigsten Upload-Typ blind.
  assert.match(noteModel, /size: Number,\s*\n\s*uploadedAt: Date\s*\n\s*}\],\s*\n\s*\/\/ Dateianhänge/);
  assert.match(imageHandler, /size: file\.size/);
  assert.match(service, /size: asset\.size \?\? 0/, 'Import-Anhänge zählen mit');
});

// v1.16.0-Review: Die Quota wird dem NOTIZ-EIGENTÜMER berechnet, nicht dem
// Uploader — die Bytes landen in owner.images[]/files[] und in dessen
// getStorageUsage. Ein Mitarbeiter mit leerem Konto würde sonst am Limit des
// Eigentümers vorbei hochladen (Shared-Note-Kollaboration).
test('upload handlers bill the quota to the note owner, not the uploader', () => {
  const pipeline = fs.readFileSync(path.join(__dirname, '../utils/attachmentUpload.js'), 'utf8');
  const calls = [...pipeline.matchAll(/assertStorageQuota\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(calls.length >= 2, `both handlers must check the quota (found ${calls.length})`);
  for (const callArgs of calls) {
    assert.match(
      callArgs,
      /req\.ownedNote\.userId/,
      `quota must bill the note owner (got: ${callArgs.trim()})`
    );
  }
});
