const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Audit 2026-09-12 (Top-30 Nr. 16): Der Editor-Zustand lebte ausschließlich in
// React-State (`rg localStorage client/src/components/NoteModal.jsx` → 0
// Treffer). Sitzungsablauf (401 → AuthContext loggt aus → Editor entmountet),
// der ErrorBoundary-Reset (`window.location.reload()`), ein Reload/Tab-Close und
// `Ctrl+Shift+L` kosteten das gerade Getippte komplett.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const draftUrl = pathToFileURL(path.join(__dirname, '../src/utils/noteDraft.mjs')).href;

/** Minimaler localStorage-Stub (Privat-Modus/Quota-Verhalten wird separat getestet). */
function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

test('a draft survives write and read with all editor fields', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft, DRAFT_STORAGE_KEY } = await import(draftUrl);

  const written = writeDraft('note-1', 'user-1', {
    title: 'Einkauf',
    content: 'Milch & Brot < 2 EUR',
    tags: ['einkauf'],
    todoItems: [{ text: 'Milch', completed: false }],
    isTodoList: true,
    color: '#fff740',
    savedAt: 1_700_000_000_000
  }, storage);

  assert.equal(written.title, 'Einkauf');
  const stored = JSON.parse(storage.store.get(DRAFT_STORAGE_KEY));
  assert.deepEqual(Object.keys(stored), ['user-1:note-1']);

  const draft = readDraft('note-1', 'user-1', storage);
  assert.equal(draft.content, 'Milch & Brot < 2 EUR');
  assert.deepEqual(draft.tags, ['einkauf']);
  assert.deepEqual(draft.todoItems, [{ text: 'Milch', completed: false }]);
  assert.equal(draft.isTodoList, true);
  assert.equal(draft.color, '#fff740');
  assert.equal(draft.savedAt, 1_700_000_000_000);
});

test('drafts are namespaced per account', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft } = await import(draftUrl);

  writeDraft('note-1', 'alice', { content: 'alice privat' }, storage);
  writeDraft('note-1', 'bob', { content: 'bob privat' }, storage);

  assert.equal(readDraft('note-1', 'alice', storage).content, 'alice privat');
  assert.equal(readDraft('note-1', 'bob', storage).content, 'bob privat');
  assert.equal(readDraft('note-1', 'carol', storage), null, 'a third account sees nothing');
  assert.equal(readDraft('note-2', 'alice', storage), null, 'a different note has no draft');
});

test('a new note drafts under its own key', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft, draftKey } = await import(draftUrl);

  assert.equal(draftKey(null, 'alice'), 'alice:new');
  writeDraft(null, 'alice', { content: 'noch nicht gespeichert' }, storage);
  assert.equal(readDraft(null, 'alice', storage).content, 'noch nicht gespeichert');
});

test('the draft store is capped and evicts the oldest entry', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft, readAllDrafts, MAX_DRAFTS } = await import(draftUrl);

  for (let index = 0; index < MAX_DRAFTS + 3; index += 1) {
    writeDraft(`note-${index}`, 'alice', { content: `Inhalt ${index}`, savedAt: 1_700_000_000_000 + index }, storage);
  }

  const all = readAllDrafts(storage);
  assert.equal(Object.keys(all).length, MAX_DRAFTS, 'no unbounded localStorage growth');
  assert.equal(readDraft('note-0', 'alice', storage), null, 'the oldest draft is gone');
  assert.equal(readDraft(`note-${MAX_DRAFTS + 2}`, 'alice', storage).content, `Inhalt ${MAX_DRAFTS + 2}`);
});

test('an oversized draft is trimmed instead of evicting everything else', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft, MAX_ENTRY_BYTES } = await import(draftUrl);

  writeDraft('note-keep', 'alice', { content: 'bleibt' }, storage);
  const written = writeDraft('note-huge', 'alice', { content: 'x'.repeat(200_000) }, storage);

  assert.ok(written, 'the draft is kept in trimmed form');
  assert.equal(written.truncated, true);
  assert.ok(JSON.stringify(written).length <= MAX_ENTRY_BYTES, 'the entry respects the size cap');
  assert.equal(readDraft('note-keep', 'alice', storage).content, 'bleibt', 'other drafts survive');
});

test('clearDraft and clearDraftsForUser remove exactly what they should', async () => {
  const storage = memoryStorage();
  const { writeDraft, readDraft, clearDraft, clearDraftsForUser } = await import(draftUrl);

  writeDraft('note-1', 'alice', { content: 'a1' }, storage);
  writeDraft('note-2', 'alice', { content: 'a2' }, storage);
  writeDraft('note-1', 'bob', { content: 'b1' }, storage);

  assert.equal(clearDraft('note-1', 'alice', storage), true);
  assert.equal(readDraft('note-1', 'alice', storage), null);
  assert.equal(readDraft('note-2', 'alice', storage).content, 'a2');
  assert.equal(clearDraft('note-1', 'alice', storage), false, 'clearing twice is a no-op');

  assert.equal(clearDraftsForUser('alice', storage), 1);
  assert.equal(readDraft('note-2', 'alice', storage), null);
  assert.equal(readDraft('note-1', 'bob', storage).content, 'b1', 'other accounts keep their drafts');
});

test('a draft is only offered when it differs and is newer than the server state', async () => {
  const { draftDiffers, isDraftWorthRestoring } = await import(draftUrl);
  const note = { title: 'Alt', content: 'Server-Stand', tags: [], updatedAt: '2026-09-12T10:00:00.000Z' };

  assert.equal(draftDiffers(null, note), false);
  assert.equal(draftDiffers({ title: 'Alt', content: 'Server-Stand', tags: [] }, note), false);
  assert.equal(draftDiffers({ content: 'Server-Stand neu' }, note), true);
  assert.equal(draftDiffers({ tags: ['neu'] }, note), true);

  const newer = { content: 'gerettet', savedAt: Date.parse(note.updatedAt) + 60_000 };
  const older = { content: 'veraltet', savedAt: Date.parse(note.updatedAt) - 60_000 };
  assert.equal(isDraftWorthRestoring(newer, note), true);
  assert.equal(isDraftWorthRestoring(older, note), false, 'a stale draft must not overwrite newer server data');
  assert.equal(isDraftWorthRestoring({ content: 'neu' }, null), true, 'a new note has no server state');
  assert.equal(isDraftWorthRestoring({ title: 'Alt', content: 'Server-Stand', tags: [] }, note), false,
    'identical content is not worth a banner');
});

test('corrupt or unavailable storage never throws', async () => {
  const { readAllDrafts, readDraft, writeDraft } = await import(draftUrl);

  assert.deepEqual(readAllDrafts(memoryStorage({ keeplocal_drafts: '{kaputt' })), {});
  assert.deepEqual(readAllDrafts(memoryStorage({ keeplocal_drafts: '[1,2,3]' })), {});
  assert.equal(readDraft('note-1', 'alice', memoryStorage({ keeplocal_drafts: 'null' })), null);

  const hostile = {
    getItem() { throw new Error('SecurityError: storage disabled'); },
    setItem() { throw new Error('QuotaExceededError'); }
  };
  assert.deepEqual(readAllDrafts(hostile), {});
  assert.equal(readDraft('note-1', 'alice', hostile), null);
  assert.equal(writeDraft('note-1', 'alice', { content: 'x' }, hostile), null, 'a quota error must not crash the editor');
  assert.equal(writeDraft('note-1', 'alice', { content: 'x' }, null), null, 'no storage at all is fine too');
});

test('the editor writes drafts debounced, flushes on hide and clears after saving', () => {
  const modal = read('components', 'NoteModal.jsx');

  assert.match(modal, /from '\.\.\/utils\/noteDraft\.mjs';/);
  assert.match(modal, /const DRAFT_DEBOUNCE_MS = 400;/);
  assert.match(modal, /const draft = readDraft\(note\?\._id \|\| null, draftUserId\);/);
  assert.match(modal, /if \(isDraftWorthRestoring\(draft, note\)\) \{\n\s+setDraftOffer\(draft\);/);
  assert.match(modal, /draftTimerRef\.current = setTimeout\(/, 'writes are debounced');
  assert.match(modal, /if \(draftFirstRunRef\.current\) \{\n\s+draftFirstRunRef\.current = false;\n\s+return undefined;/,
    'opening an unchanged editor must not create a draft');
  assert.match(modal, /window\.addEventListener\('pagehide', flush\)/);
  assert.match(modal, /document\.addEventListener\('visibilitychange', onVisibility\)/);
  assert.match(modal, /document\.visibilityState === 'hidden'/);
  assert.match(modal, /clearDraft\(note\?\._id \|\| null, draftUserId\);\n\s+onClose\(\);/, 'saving clears the draft');
  assert.match(modal, /className="note-modal-conflict note-modal-draft" role="alert"/);
  assert.match(modal, /btn-draft-restore/);
  assert.match(modal, /btn-draft-discard/);
  assert.match(modal, /if \(draftOffer\) return;/, 'no draft is written while the decision is pending');
  // Die 409-Mechanik darf durch einen wiederhergestellten Entwurf nicht
  // ausgehebelt werden.
  const restoreBody = modal.slice(modal.indexOf('const restoreDraft'), modal.indexOf('const discardDraft'));
  assert.doesNotMatch(restoreBody, /baseUpdatedAtRef\.current\s*=/,
    'restoring a draft must not rewrite baseUpdatedAt (the 409 guard stays armed)');
  assert.match(modal, /noteUpdatedAt: note\?\.updatedAt \|\| null/, 'the draft records the server state it was written against');
});

test('drafts are account data and die with the logout', () => {
  const auth = read('contexts', 'AuthContext.jsx');
  assert.match(auth, /import \{ clearDraftsForUser \} from '\.\.\/utils\/noteDraft\.mjs';/);
  assert.match(auth, /clearDraftsForUser\(user\?\._id \|\| user\?\.id \|\| null\);/);
  const logoutAt = auth.indexOf('const logout = async () => {');
  const clearAt = auth.indexOf('clearDraftsForUser(');
  assert.ok(clearAt > logoutAt, 'the drafts are cleared as part of logout');
});

test('both languages translate the draft banner', () => {
  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    for (const key of ['draftFoundTitle', 'draftFoundMessage', 'draftRestore', 'draftDiscard']) {
      assert.match(translations, new RegExp(`${key}:`), `${file} must translate ${key}`);
    }
  }
});

// Flake vom 2026-09-16 (E2E spec.mjs:1022): Nach dem Verwerfen bot der Editor
// beim nächsten Öffnen wieder einen „Entwurf" an. persistDraft schrieb den leeren
// Editor-Zustand, weil das Verwerfen die persistDraft-Identität änderte und der
// Debounce-Effekt dadurch ohne Nutzereingabe erneut lief; auf einem langsamen
// Runner feuerte der Write, bevor der Unmount den Timer clearte.
test('draftHasSubstance rejects drafts without visible content', async () => {
  const { draftHasSubstance } = await import(draftUrl);
  assert.equal(draftHasSubstance(null), false);
  assert.equal(draftHasSubstance({}), false);
  assert.equal(draftHasSubstance({ title: '', content: '' }), false);
  assert.equal(draftHasSubstance({ title: '   ', content: '\n\t' }), false, 'whitespace is not substance');
  assert.equal(draftHasSubstance({ title: '', content: '', tags: [], todoItems: [] }), false);
  // Eine nur angefasste Farbe/Notizart allein ist kein wiederherstellbarer Verlust.
  assert.equal(draftHasSubstance({ title: '', content: '', color: '#fff740', isTodoList: true }), false);
  // Leere Todo-Einträge (Komplett-Löschen der Texte) haben ebenfalls keine Substanz.
  assert.equal(draftHasSubstance({ todoItems: [{ text: '  ', completed: false }] }), false);
});

test('draftHasSubstance accepts any real content', async () => {
  const { draftHasSubstance } = await import(draftUrl);
  assert.equal(draftHasSubstance({ title: 'Einkauf' }), true);
  assert.equal(draftHasSubstance({ content: 'Milch' }), true);
  assert.equal(draftHasSubstance({ tags: ['einkauf'] }), true);
  assert.equal(draftHasSubstance({ todoItems: [{ text: 'Milch', completed: false }] }), true);
});

test('the editor never writes or resurrects a discarded draft', () => {
  const modal = read('components', 'NoteModal.jsx');
  assert.match(modal, /draftHasSubstance/, 'persistDraft consults the substance guard');
  const persistBody = modal.slice(modal.indexOf('const persistDraft'), modal.indexOf('// Nach jeder Änderung'));
  assert.match(
    persistBody,
    /if \(!draftHasSubstance\(draft\)\) \{\s*\n\s*clearTimeout\(draftTimerRef\.current\);\s*\n\s*return;\s*\n\s*\}/,
    'substance-less drafts are neither written nor left on a running timer'
  );
  const discardBody = modal.slice(modal.indexOf('const discardDraft'), modal.indexOf('// Reset the form'));
  assert.match(discardBody, /clearTimeout\(draftTimerRef\.current\);/,
    'discarding cancels a pending debounce write before it can resurrect the draft');
});
