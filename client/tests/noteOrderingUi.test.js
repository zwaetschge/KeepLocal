const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Improvement #5: drag & drop inside a section must persist. Before, the local
// reorder was immediately undone by the updatedAt sort and never sent anywhere.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const payloadUrl = pathToFileURL(path.join(__dirname, '../src/utils/notesPayload.mjs')).href;
const hookUrl = pathToFileURL(path.join(__dirname, '../src/hooks/useNotesManager.js')).href;

test('the notes API can persist a manual order', () => {
  const constants = read('constants', 'api.js');
  assert.match(constants, /REORDER: '\/api\/notes\/reorder'/);

  const api = read('services', 'api', 'notesAPI.js');
  assert.match(api, /reorder: \(orderedIds\) =>/);
  assert.match(api, /method: 'PATCH'/);
  assert.match(api, /JSON\.stringify\(\{ orderedIds \}\)/);

  // PATCH is part of the CSRF-protected methods.
  assert.match(read('constants', 'api.js'), /CSRF_METHODS = \['POST', 'PUT', 'DELETE', 'PATCH'\]/);
});

test('a drop sends the section order and falls back on failure', () => {
  const hook = read('hooks', 'useNotesManager.js');

  assert.match(hook, /const reordered = applyMutationLocally\(stateRef\.current\.notes, \{ type: 'reorder', sourceId, targetId: targetNoteId \}\);/);
  assert.match(hook, /await api\.reorder\(orderedIds\);/);
  // Only the ids of the section that was dragged in, top first.
  assert.match(hook, /\.filter\(item => Boolean\(item\.isPinned\) === sectionIsPinned\)/);
  assert.match(hook, /\.map\(item => item\._id\);/);
  // A failed persist must not leave the UI in a state the server does not know.
  assert.match(hook, /catch \(error\) \{[\s\S]{0,400}?refreshInBackground\(stateRef\.current\.searchTerm, stateRef\.current\.pagination\.page\);/);
});

test('search relevance beats manual order, which beats recency', () => {
  const hook = read('hooks', 'useNotesManager.js');

  assert.match(hook, /const hasManualOrder = filtered\.some\(item => Number\(item\.order\) > 0\);/);
  // While searching, the server already sorted by weighted textScore — sorting
  // again here would throw the relevance away.
  assert.match(hook, /const isSearching = searchTerm\.trim\(\) !== '';/);
  assert.match(hook, /const comparator = isSearching\s*\? null\s*: hasManualOrder/);
  assert.match(hook, /\(\(Number\(b\.order\) \|\| 0\) - \(Number\(a\.order\) \|\| 0\)\) \|\| byRecency\(a, b\)/);
  assert.match(hook, /const order = \(items\) => \(comparator \? items\.sort\(comparator\) : items\);/);
  assert.match(hook, /pinnedNotes: order\(filtered\.filter\(item => item\.isPinned\)\)/);
  assert.match(hook, /otherNotes: order\(filtered\.filter\(item => !item\.isPinned\)\)/);
  // v1.11.1: Der Ordner-Scope filtert der SERVER (params.folderId) — hier
  // steht folderScope nicht mehr in den Memo-Deps, dafür im Fetch-Effekt.
  assert.match(hook, /\}, \[notes, selectedTag, searchTerm\]\);/);
  assert.doesNotMatch(hook, /filtered = filtered\.filter\(item => item\.parentId === folderScope\)/,
    'Ordner-Filter darf nicht mehr clientseitig auf dem geladenen Fenster laufen');
  assert.match(hook, /if \(!trashView && stateRef\.current\.folderScope\) params\.folderId = stateRef\.current\.folderScope;/);
  assert.match(hook, /\[isLoggedIn, authLoading, showArchived, showTrash, selectedTag, searchTerm, folderScope, fetchNotes, refreshTree\]/,
    'Scope-Wechsel muss die Liste neu laden');
});

test('the payload normalizer keeps a numeric order', async () => {
  const { normalizeNote, normalizeNotesPayload } = await import(payloadUrl);

  assert.equal(normalizeNote({ _id: 'a', order: 7 }).order, 7);
  assert.equal(normalizeNote({ _id: 'a', order: '12' }).order, 12);
  assert.equal(normalizeNote({ _id: 'a' }).order, 0);
  assert.equal(normalizeNote({ _id: 'a', order: 'nonsense' }).order, 0);

  const { notes } = normalizeNotesPayload({ notes: [{ _id: 'a', order: 3 }, { _id: 'b' }] });
  assert.deepEqual(notes.map(note => note.order), [3, 0]);
});

test('reordering keeps the visible list stable across a refetch', async () => {
  const { applyMutationLocally, mergeIfChanged } = await import(hookUrl);

  const notes = [
    { _id: 'a', updatedAt: '2026-09-01T10:00:00.000Z', isPinned: false, isArchived: false },
    { _id: 'b', updatedAt: '2026-09-02T10:00:00.000Z', isPinned: false, isArchived: false },
    { _id: 'c', updatedAt: '2026-09-03T10:00:00.000Z', isPinned: false, isArchived: false }
  ];
  const reordered = applyMutationLocally(notes, { type: 'reorder', sourceId: 'c', targetId: 'a' });
  assert.deepEqual(reordered.map(note => note._id), ['c', 'a', 'b']);

  // A refetch that returns the same sequence must not be treated as a change
  // (identity is preserved, so no re-render churn), while a different sequence
  // is applied.
  const same = mergeIfChanged({ notes: reordered }, { notes: reordered.map(note => ({ ...note })) });
  assert.equal(same.notes, reordered);

  const changed = mergeIfChanged({ notes: reordered }, { notes: [reordered[1], reordered[0], reordered[2]] });
  assert.deepEqual(changed.notes.map(note => note._id), ['a', 'c', 'b']);
});
