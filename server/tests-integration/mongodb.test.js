const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Audit 2026-09-12 (Top-30 Nr. 23): Die Server-Suite lief vollständig gegen
// gemockte Modelle — MongoDB-Semantik ($expr/$size, partielle und TTL-Indizes,
// Aggregationen, explain(), Unique-Verletzungen) war prinzipiell ungeprüft.
// Zwei der teuersten Funde saßen genau dort: der fehlende Index auf
// `images.filename` (COLLSCAN pro Thumbnail, Top-30 Nr. 11) und die
// Papierkorb-Zählungen (Nr. 5).
//
// Läuft nur mit INTEGRATION_MONGODB_URI (CI: eigener Job mit mongo:7, lokal:
// `docker run -d -p 27099:27017 mongo:7`).

const {
  INTEGRATION_URI,
  models,
  connect,
  disconnect,
  resetDatabase,
  seedUser,
  seedNote,
  indexNames,
  explainQuery
} = require('./harness');

const skip = INTEGRATION_URI ? false : 'INTEGRATION_MONGODB_URI ist nicht gesetzt';

test('setup: connected to a real MongoDB', { skip }, async () => {
  const connected = await connect();
  assert.equal(connected, true);
});

test('the schema indexes exist with the options the queries rely on', { skip }, async () => {
  const mongoose = require('mongoose');
  const notes = await mongoose.connection.db.collection('notes').indexes();
  const users = await mongoose.connection.db.collection('users').indexes();
  const byName = (list) => Object.fromEntries(list.map((index) => [index.name, index]));
  const noteIndexes = byName(notes);
  const userIndexes = byName(users);

  // Bildauslieferung (Top-30 Nr. 11): ohne diese beiden Indizes ist jeder
  // Thumbnail ein COLLSCAN über die instanzweite Collection.
  assert.ok(noteIndexes['images.filename_1'], 'images.filename must be indexed');
  assert.ok(noteIndexes['images.thumbnailFilename_1'], 'images.thumbnailFilename must be indexed');
  assert.notEqual(noteIndexes['images.filename_1'].unique, true, 'a failed unique build would kill startup');

  // Papierkorb: 31 Tage Backstop hinter dem Janitor (30 Tage Retention).
  assert.equal(noteIndexes.trash_ttl?.expireAfterSeconds, 31 * 24 * 60 * 60);
  assert.deepEqual(noteIndexes.trash_ttl?.partialFilterExpression, { deletedAt: { $type: 'date' } });

  // Suche: gewichteter Textindex, neutrale Sprache.
  assert.equal(noteIndexes.note_text_search?.weights?.title, 5);
  assert.equal(noteIndexes.note_text_search?.weights?.['todoItems.text'], 2);
  assert.equal(noteIndexes.note_text_search?.default_language, 'none');

  // OAuth: eindeutig, aber nur wenn eine providerId existiert.
  assert.equal(userIndexes.provider_1_providerId_1?.unique, true);
  assert.deepEqual(userIndexes.provider_1_providerId_1?.partialFilterExpression, { providerId: { $type: 'string' } });
  assert.equal(userIndexes.single_bootstrap_admin?.unique, true);

  await resetDatabase();
});

test('two local accounts without a providerId are allowed, duplicates are not', { skip }, async () => {
  const { User } = models();
  await User.create({ username: 'local-a', email: 'a@example.com', password: 'Integration1x', provider: 'local', providerId: null });
  await User.create({ username: 'local-b', email: 'b@example.com', password: 'Integration1x', provider: 'local', providerId: null });
  assert.equal(await User.countDocuments({ provider: 'local' }), 2, 'the partial index must not treat null providerIds as duplicates');

  await User.create({ username: 'oauth-a', email: 'oauth@example.com', provider: 'google', providerId: 'google-1' });
  await assert.rejects(
    User.create({ username: 'oauth-b', email: 'other@example.com', provider: 'google', providerId: 'google-1' }),
    /duplicate key error/,
    'the same provider identity must be unique'
  );

  await User.create({ username: 'bootstrap', email: 'boot@example.com', password: 'Integration1x', provider: 'local', isBootstrapAdmin: true });
  await assert.rejects(
    User.create({ username: 'bootstrap2', email: 'boot2@example.com', password: 'Integration1x', provider: 'local', isBootstrapAdmin: true }),
    /duplicate key error/,
    'only one bootstrap admin may exist'
  );

  await resetDatabase();
});

test('the image lookup uses an index instead of scanning the collection', { skip }, async () => {
  const mongoose = require('mongoose');
  const { Note } = models();
  const owner = await seedUser();

  const docs = [];
  for (let index = 0; index < 2000; index += 1) {
    docs.push({
      userId: owner._id,
      title: `Notiz ${index}`,
      content: 'Fülltext',
      isArchived: false,
      isPinned: false,
      deletedAt: null,
      images: index === 1500 ? [{ filename: 'gesucht.png', thumbnailFilename: 'gesucht-thumb.webp' }] : []
    });
  }
  await Note.insertMany(docs);

  const query = { $or: [{ 'images.filename': 'gesucht.png' }, { 'images.thumbnailFilename': 'gesucht.png' }] };
  const { stages, stats } = await explainQuery('notes', query);

  assert.ok(stages.includes('IXSCAN'), `expected an index scan, got ${stages.join(' > ')}`);
  assert.equal(stages.includes('COLLSCAN'), false, 'the hot path must not scan the collection');
  assert.ok(stats.totalDocsExamined <= 5, `examined ${stats.totalDocsExamined} documents for one image`);
  assert.equal(stats.nReturned, 1);

  await resetDatabase();
});

test('trashed notes leave every list and count but stay restorable', { skip }, async () => {
  const notesService = require('../services/notesService');
  const owner = await seedUser();
  const keep = await seedNote(owner._id, { title: 'bleibt', tags: ['x'] });
  const gone = await seedNote(owner._id, { title: 'verschwindet', tags: ['x'] });

  await notesService.deleteNote(gone._id.toString(), owner._id.toString());

  const active = await notesService.getAllNotes({ userId: owner._id });
  assert.deepEqual(active.notes.map((note) => note.title), ['bleibt']);
  assert.deepEqual(active.counts, { active: 1, archived: 0, trash: 1 });
  // Die Browser-Aggregation liefert {name, count} (routes/v1/tags.js dagegen
  // {tag, count}) — beide müssen den Papierkorb auszählen.
  assert.deepEqual(active.tags.map((tag) => tag.name), ['x']);
  assert.equal(active.tags[0].count, 1, 'tag counts must not include the trash (Top-30 Nr. 5)');

  const trash = await notesService.getAllNotes({ userId: owner._id, deleted: 'true' });
  assert.deepEqual(trash.notes.map((note) => note.title), ['verschwindet']);

  const restored = await notesService.restoreNote(gone._id.toString(), owner._id.toString());
  assert.equal(restored.deletedAt, null);
  const afterRestore = await notesService.getAllNotes({ userId: owner._id });
  assert.deepEqual(afterRestore.counts, { active: 2, archived: 0, trash: 0 });
  assert.equal(keep.title, 'bleibt');

  // Endgültig löschen darf nur aus dem Papierkorb heraus gehen — eine aktive
  // Notiz muss mit 404 abgewiesen werden (sonst wäre ?permanent ein
  // Hintenherum-Hartlöschen).
  await assert.rejects(
    notesService.purgeNote(gone._id.toString(), owner._id.toString()),
    (error) => {
      assert.equal(error.statusCode, 404);
      return true;
    }
  );

  await notesService.deleteNote(gone._id.toString(), owner._id.toString());
  await notesService.purgeNote(gone._id.toString(), owner._id.toString());
  const afterPurge = await notesService.getAllNotes({ userId: owner._id });
  assert.deepEqual(afterPurge.counts, { active: 1, archived: 0, trash: 0 });

  await resetDatabase();
});

test('search ranks a title match above a body match (weighted text index)', { skip }, async () => {
  const notesService = require('../services/notesService');
  const owner = await seedUser();
  await seedNote(owner._id, { title: 'Beliebig', content: 'Zwiebeln und Brot' });
  await seedNote(owner._id, { title: 'Zwiebeln kaufen', content: 'irgendwas' });

  const result = await notesService.getAllNotes({ userId: owner._id, search: 'Zwiebeln' });
  assert.deepEqual(result.notes.map((note) => note.title), ['Zwiebeln kaufen', 'Beliebig'],
    'title weight 5 must outrank the body hit');

  await resetDatabase();
});

test('the image limit is enforced by the database, not by a stale count', { skip }, async () => {
  const notesService = require('../services/notesService');
  const owner = await seedUser();
  const existing = Array.from({ length: 25 }, (_, index) => ({ filename: `bild-${index}.png` }));
  const note = await seedNote(owner._id, { images: existing });

  await assert.rejects(
    notesService.addImages(note._id.toString(), owner._id.toString(), [{ filename: 'zu-viel.png' }]),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /25 Bilder/);
      return true;
    },
    'the $expr/$size guard must reject the 26th image'
  );

  const roomy = await seedNote(owner._id, { images: [{ filename: 'eins.png' }] });
  const updated = await notesService.addImages(roomy._id.toString(), owner._id.toString(), [{ filename: 'zwei.png' }]);
  assert.equal(updated.images.length, 2);

  await resetDatabase();
});

test('manual ordering survives a reload of the list', { skip }, async () => {
  const notesService = require('../services/notesService');
  const owner = await seedUser();
  const first = await seedNote(owner._id, { title: 'A' });
  const second = await seedNote(owner._id, { title: 'B' });
  const third = await seedNote(owner._id, { title: 'C' });

  const before = await notesService.getAllNotes({ userId: owner._id });
  assert.deepEqual(before.notes.map((note) => note.title), ['C', 'B', 'A'], 'recency first without a manual order');

  await notesService.reorderNotes(owner._id.toString(), [first._id, second._id, third._id]);
  const after = await notesService.getAllNotes({ userId: owner._id });
  assert.deepEqual(after.notes.map((note) => note.title), ['A', 'B', 'C'], 'the manual order is persisted');

  await resetDatabase();
});

test('the storage janitor deletes expired trash including its files', { skip }, async () => {
  const janitor = require('../services/storageJanitor');
  const { Note } = models();
  const uploads = path.join(__dirname, '../uploads/images');
  fs.mkdirSync(uploads, { recursive: true });

  const owner = await seedUser();
  const oldFile = path.join(uploads, `janitor-it-${process.pid}.png`);
  const oldThumb = path.join(uploads, `janitor-it-${process.pid}-thumb.webp`);
  fs.writeFileSync(oldFile, 'alt');
  fs.writeFileSync(oldThumb, 'alt');

  const expired = await Note.create({
    userId: owner._id,
    title: 'abgelaufen',
    content: 'x',
    deletedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    images: [{ filename: path.basename(oldFile), thumbnailFilename: path.basename(oldThumb) }]
  });
  const young = await seedNote(owner._id, { title: 'jung', deletedAt: new Date() });

  const result = await janitor.purgeExpiredTrash({ retentionDays: 30 });

  assert.equal(result.notes, 1);
  assert.equal(result.files, 2);
  assert.equal(await Note.countDocuments({ _id: expired._id }), 0, 'the expired note is gone');
  assert.equal(await Note.countDocuments({ _id: young._id }), 1, 'a young trash note stays');
  assert.equal(fs.existsSync(oldFile), false, 'its image file is gone');
  assert.equal(fs.existsSync(oldThumb), false, 'its thumbnail is gone');

  // Die verbleibende Notiz im Papierkorb darf ihre Dateien behalten.
  const orphans = await janitor.removeOrphanedImages({ minAgeHours: 0 });
  assert.equal(typeof orphans.files, 'number');
  await resetDatabase();
});

test('teardown', { skip }, async () => {
  await disconnect();
});
