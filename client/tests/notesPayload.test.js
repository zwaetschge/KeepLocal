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
  assert.deepEqual(normalized.counts, { active: 8, archived: 0, trash: 0 });
});

test('notes payload normalization supplies a safe empty response', async () => {
  const { normalizeNotesPayload } = await import(moduleUrl);

  assert.deepEqual(normalizeNotesPayload(null), {
    notes: [],
    pagination: { page: 1, limit: 50, total: 0, pages: 0 },
    counts: { active: 0, archived: 0, trash: 0 },
    tags: [],
    // v1.14.0: Flags markieren die ABWESENHEIT von counts/tags (siehe Test
    // unten) — Substitution in applyServerState nur bei keepAbsentMeta.
    hasCounts: false,
    hasTags: false
  });
});

// v1.10.0: Baum-Eltern (parentId) und Code-Notizen (isCode)
test('normalizeNote keeps parentId (string or null) and isCode', async () => {
  const { normalizeNote } = await import(moduleUrl);

  assert.equal(normalizeNote({ _id: 'a', parentId: '64b1f0c9a1d4e5f6a7b8c9d0' }).parentId, '64b1f0c9a1d4e5f6a7b8c9d0');
  assert.equal(normalizeNote({ _id: 'a', parentId: undefined }).parentId, null);
  assert.equal(normalizeNote({ _id: 'a', parentId: 42 }).parentId, null, 'kein String -> null');
  assert.equal(normalizeNote({ _id: 'a' }).isCode, false);
  assert.equal(normalizeNote({ _id: 'a', isCode: true }).isCode, true);
  assert.equal(normalizeNote({ _id: 'a', isCode: 'yes' }).isCode, true);
});

// v1.14.0 Nr. 8: Folgeseiten fragen includeMeta=false an — die Antwort kommt
// ohne counts/tags. normalizeNotesPayload muss das markieren (statt still auf
// 0 zu fallen), applyServerState hält dann den bestehenden Sidebar-Stand.
test('normalizeNotesPayload flags absent counts and tags instead of silently zeroing', async () => {
  const { normalizeNotesPayload } = await import(moduleUrl);

  const lean = normalizeNotesPayload({ notes: [], pagination: { page: 2, limit: 50, total: 9, pages: 1 } });
  assert.equal(lean.hasCounts, false, 'kein counts-Schlüssel in der Antwort');
  assert.equal(lean.hasTags, false, 'kein tags-Schlüssel in der Antwort');
  // Die Defaults bleiben bestehen (Backward-kompatibel fürAufrufer ohne Flags):
  assert.deepEqual(lean.counts, { active: 0, archived: 0, trash: 0 });
  assert.deepEqual(lean.tags, []);

  const full = normalizeNotesPayload({
    notes: [],
    pagination: { page: 1 },
    counts: { active: 3, archived: 1, trash: 0 },
    tags: [{ name: 'x', count: 1 }]
  });
  assert.equal(full.hasCounts, true);
  assert.equal(full.hasTags, true);

  // Die Flags beschreiben nur die Antwort, nicht die Absicht: Bei
  // null (Total-Ausfall) ist hasCounts ebenfalls false — die Substitution
  // greift aber nur, wenn der Aufrufer keepAbsentMeta gesetzt hat (er hat
  // includeMeta=false angefordert). Ein ungefragter Ausfall fällt weiter
  // auf 0, wie vorher.
  assert.equal(normalizeNotesPayload(null).hasCounts, false);
});
