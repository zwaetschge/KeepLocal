const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/notesPayload.mjs')
).href;

test('notes payload normalization makes malformed API collections render-safe', async () => {
  const { normalizeNotesPayload } = await import(moduleUrl);
  const payload = {
    notes: [
      null,
      {
        _id: 'note-1',
        title: 42,
        content: null,
        tags: ['valid', null, 2],
        images: 'not-an-array',
        todoItems: [{ text: 'Keep', completed: true }, null, 'bad'],
        linkPreviews: [{ url: 'https://example.test' }, null],
        sharedWith: [{ username: 'tester' }, null]
      }
    ],
    tags: null,
    pagination: { page: 'bad', limit: 50, pages: 4, total: 9 },
    counts: { active: 8, archived: 'bad' }
  };

  const normalized = normalizeNotesPayload(payload);

  assert.equal(normalized.notes.length, 1);
  assert.equal(normalized.notes[0].title, '');
  assert.equal(normalized.notes[0].content, '');
  assert.deepEqual(normalized.notes[0].tags, ['valid']);
  assert.deepEqual(normalized.notes[0].images, []);
  assert.deepEqual(normalized.notes[0].todoItems, [{ text: 'Keep', completed: true }]);
  assert.deepEqual(normalized.notes[0].linkPreviews, [{
    url: 'https://example.test',
    title: '',
    description: '',
    image: '',
    siteName: ''
  }]);
  assert.deepEqual(normalized.notes[0].sharedWith, [{ username: 'tester', email: '' }]);
  assert.deepEqual(normalized.tags, []);
  assert.deepEqual(normalized.pagination, { page: 1, limit: 50, pages: 4, total: 9 });
  assert.deepEqual(normalized.counts, { active: 8, archived: 0 });
});

test('notes payload normalization supplies a safe empty response', async () => {
  const { normalizeNotesPayload } = await import(moduleUrl);

  assert.deepEqual(normalizeNotesPayload(null), {
    notes: [],
    pagination: { page: 1, limit: 50, total: 0, pages: 0 },
    counts: { active: 0, archived: 0 },
    tags: []
  });
});
