const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
// Each test file owns a separate database even when Node runs files concurrently.
if (process.env.INTEGRATION_MONGODB_URI) {
  const uri = new URL(process.env.INTEGRATION_MONGODB_URI);
  if (/(integration|e2e|test|ci)/i.test(uri.pathname)) {
    uri.pathname += '-keep-parity';
    process.env.INTEGRATION_MONGODB_URI = uri.toString();
  }
}
const harness = require('./harness');
const mongoose = require('mongoose');
const Organization = require('../models/NoteOrganization');
const Note = require('../models/Note');
const service = require('../services/notesService');
const { validateFeatures } = require('../utils/noteFeatures');
const { ensureNoteTextIndex } = require('../config/indexMigration');
before(async () => {
  if (harness.INTEGRATION_URI) await harness.connect();
});
after(() => harness.disconnect());
test(
  'personal organization never changes another participant, filters before pagination, and keeps access checks',
  { skip: !harness.INTEGRATION_URI },
  async () => {
    const owner = await harness.seedUser(),
      editor = await harness.seedUser(),
      stranger = await harness.seedUser();
    const note = await harness.seedNote(owner._id, {
      color: '#f28b82',
      tags: ['private-owner'],
      isPinned: true,
      sharedWith: [editor._id],
    });
    const plain = await service.getNoteById(note.id, editor.id, true);
    assert.equal(plain.color, '#ffffff');
    assert.deepEqual(plain.tags, []);
    await service.updateNote(
      note.id,
      {
        personalOrganization: true,
        color: '#ccff90',
        tags: ['mine'],
        isPinned: false,
        isArchived: true,
      },
      editor.id,
    );
    const mine = await service.getNoteById(note.id, editor.id, true);
    assert.equal(mine.color, '#ccff90');
    assert.equal(mine.isArchived, true);
    const theirs = await service.getNoteById(note.id, owner.id, true);
    assert.equal(theirs.color, '#f28b82');
    assert.equal(theirs.isArchived, false);
    assert.deepEqual(theirs.tags, ['private-owner']);
    const filtered = await service.getAllNotes({
      userId: editor.id,
      personal: true,
      color: '#ccff90',
      tag: 'mine',
      archived: 'true',
      limit: 1,
    });
    assert.equal(filtered.pagination.total, 1);
    assert.equal(String(filtered.notes[0]._id), note.id);
    assert.equal(filtered.counts.archived, 1);
    const absent = await service.getAllNotes({
      userId: stranger.id,
      personal: true,
      color: '#ccff90',
      archived: 'true',
    });
    assert.equal(absent.pagination.total, 0);
    await assert.rejects(
      service.updateNote(
        note.id,
        { personalOrganization: true, color: '#ffffff' },
        stranger.id,
      ),
      { statusCode: 404 },
    );
    await assert.rejects(
      service.getAllNotes({
        userId: owner.id,
        personal: true,
        folderId: 'bad',
      }),
      { statusCode: 400 },
    );
    assert.equal(
      await Organization.countDocuments({
        noteId: note._id,
        userId: editor._id,
      }),
      1,
    );
    await service.applyTagOperation({
      userId: editor.id,
      action: 'rename',
      from: ['mine'],
      to: 'local',
      personal: true,
    });
    assert.deepEqual(
      (await service.getNoteById(note.id, editor.id, true)).tags,
      ['local'],
    );
    assert.deepEqual(
      (await service.getNoteById(note.id, owner.id, true)).tags,
      ['private-owner'],
    );
    await service.deleteNote(note.id, owner.id);
    await service.purgeNote(note.id, owner.id);
    assert.equal(await Organization.countDocuments({ noteId: note._id }), 0);
  },
);
test(
  'title-only and request-id replay; formatting and nested list IDs survive revisions',
  { skip: !harness.INTEGRATION_URI },
  async () => {
    const owner = await harness.seedUser();
    const data = {
      title: 'Only a title',
      content: '',
      clientRequestId: 'test-replay-request',
    };
    const results = await Promise.all([
      service.createNote(data, owner.id),
      service.createNote(data, owner.id),
    ]);
    assert.equal(String(results[0]._id), String(results[1]._id));
    const features = {
      format: 'rich',
      marks: [{ type: 'bold', start: 0, end: 4 }],
      background: 'dots',
      ocrText: 'OpticalSentinel',
    };
    const updated = await service.updateNote(
      results[0].id,
      { content: 'Bold words', features },
      owner.id,
    );
    const changed = await service.updateNote(
      updated.id,
      { content: 'Bold words again', features },
      owner.id,
    );
    const stored = await Note.findById(changed.id);
    assert.deepEqual(stored.revisions.at(-1).features, features);
    const hits = await service.getAllNotes({
      userId: owner.id,
      personal: true,
      search: 'OpticalSentinel',
    });
    assert.equal(hits.pagination.total, 1);
    const list = await service.updateNote(
      changed.id,
      {
        isTodoList: true,
        todoItems: [
          {
            id: 'parent',
            text: 'Parent',
            completed: false,
            order: 0,
            indent: 0,
          },
          { id: 'child', text: 'Child', completed: false, order: 1, indent: 1 },
        ],
        features: { list: { checkedToBottom: true } },
      },
      owner.id,
    );
    assert.equal(list.todoItems[1].id, 'child');
    assert.equal(list.todoItems[1].indent, 1);
  },
);
test(
  'legacy text index is upgraded for OCR rather than preventing startup',
  { skip: !harness.INTEGRATION_URI },
  async () => {
    await Note.collection.dropIndex('note_text_search');
    await Note.collection.createIndex(
      { title: 'text', content: 'text', 'todoItems.text': 'text' },
      { name: 'legacy_note_text' },
    );
    const migration = await ensureNoteTextIndex(mongoose.connection);
    assert.equal(migration.dropped, 'legacy_note_text');
    await Note.syncIndexes();
    assert.equal(
      (await Note.collection.indexes()).find(
        (i) => i.name === 'note_text_search',
      ).weights['features.ocrText'],
      1,
    );
  },
);
test('shared feature format rejects oversized drawings and invalid ranges', () => {
  assert.throws(
    () =>
      validateFeatures(
        { format: 'rich', marks: [{ type: 'bold', start: 0, end: 10 }] },
        2,
      ),
    { statusCode: 400 },
  );
  assert.throws(
    () =>
      validateFeatures({
        drawing: {
          width: 800,
          height: 600,
          strokes: [{ color: '#000000', width: 3, points: [[Infinity, 2]] }],
        },
      }),
    { statusCode: 400 },
  );
});
test(
  'OCR and retained audio routes use note access, validate bytes, and survive export/import',
  { skip: !harness.INTEGRATION_URI },
  async () => {
    const express = require('express'),
      fs = require('node:fs/promises'),
      os = require('node:os'),
      path = require('node:path');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keep-parity-'));
    process.env.UPLOADS_DIR = root;
    process.env.OCR_LANGUAGES = 'eng';
    require('../config/paths').ensureUploadDirs();
    const owner = await harness.seedUser(),
      other = await harness.seedUser();
    const note = await service.createNote({ title: 'Audio and OCR' }, owner.id);
    const app = express(),
      router = express.Router();
    app.use((req, res, next) => {
      req.user = owner;
      next();
    });
    require('../routes/noteExtras')(router);
    app.use(router);
    app.use((err, req, res, next) =>
      res.status(err.statusCode || 500).json({ error: err.message }),
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const wav = Buffer.alloc(32044);
      wav.write('RIFF');
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(wav.length - 44, 40);
      const body = new FormData();
      body.append('audio', new Blob([wav], { type: 'audio/wav' }), 'voice.wav');
      const response = await fetch(`${base}/${note.id}/recordings`, {
        method: 'POST',
        body,
      });
      const uploaded = await response.json();
      assert.equal(response.status, 200, JSON.stringify(uploaded));
      assert.equal(uploaded.files.length, 1);
      assert.equal(uploaded.files[0].mimetype, 'audio/wav');
      const png = await require('sharp')(
        Buffer.from(
          '<svg width="1200" height="220"><rect width="1200" height="220" fill="white"/><text x="30" y="140" font-family="DejaVu Sans" font-size="90" fill="black">KEEP LOCAL 12345</text></svg>',
        ),
      )
        .png()
        .toBuffer();
      const filename = 'parity-ocr.png';
      await fs.writeFile(path.join(root, 'images', filename), png);
      await service.addImages(note.id, owner.id, [
        { filename, url: `/uploads/images/${filename}`, size: png.length },
      ]);
      const recognized = await fetch(
        `${base}/${note.id}/images/${filename}/text`,
        { method: 'POST' },
      );
      const text = await recognized.json();
      assert.equal(recognized.status, 200, JSON.stringify(text));
      assert.match(text.text, /12345/);
      const features = {
        format: 'rich',
        marks: [{ type: 'bold', start: 2, end: 6 }],
        drawing: {
          width: 800,
          height: 600,
          imageFilename: filename,
          strokes: [
            {
              color: '#202124',
              width: 3,
              points: [
                [1, 2],
                [3, 4],
              ],
            },
          ],
        },
        ocrText: text.text,
      };
      await service.updateNote(
        note.id,
        { content: '  Bold words  ', features },
        owner.id,
      );
      const archive = await service.buildMarkdownExport(owner.id, true);
      await service.importMarkdownZip(other.id, archive);
      const imported = await Note.findOne({
        userId: other._id,
        title: 'Audio and OCR',
      });
      assert.equal(imported.content, '  Bold words  ');
      assert.equal(imported.files.length, 1);
      assert.equal(imported.images.length, 1);
      assert.equal(
        imported.features.drawing.imageFilename,
        imported.images[0].filename,
      );
      assert.deepEqual(imported.features.marks, features.marks);
      const denied = await fetch(
        `${base}/${imported.id}/images/${imported.images[0].filename}/text`,
        { method: 'POST' },
      );
      assert.equal(denied.status, 404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(root, { recursive: true, force: true });
      delete process.env.UPLOADS_DIR;
    }
  },
);

test('personal search ranks title matches before newer body matches and paginates that order',
  { skip: !harness.INTEGRATION_URI }, async () => {
    const owner = await harness.seedUser();
    await Note.createIndexes();
    const title = await harness.seedNote(owner._id, { title: 'Paritaetsbrot', content: 'Mehl und Wasser' });
    const body = await harness.seedNote(owner._id, { title: 'Einkauf', content: 'Paritaetsbrot kaufen', order: 999 });
    const first = await service.getAllNotes({ userId: owner.id, personal: true, search: 'Paritaetsbrot', limit: 1 });
    assert.equal(first.pagination.total, 2);
    assert.equal(String(first.notes[0]._id), title.id);
    const second = await service.getAllNotes({ userId: owner.id, personal: true, search: 'Paritaetsbrot', limit: 1, page: 2 });
    assert.equal(String(second.notes[0]._id), body.id);
  });
