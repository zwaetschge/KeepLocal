const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Improvement #4 (VERBESSERUNGEN_2026-09-11): deleting used to be final — the
// document and its image files were gone on a mis-click. Notes now move to a
// trash (30-day TTL) with an undo toast, restore, purge and "empty trash".

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const toastBusUrl = pathToFileURL(path.join(__dirname, '../src/utils/toastBus.mjs')).href;
const payloadUrl = pathToFileURL(path.join(__dirname, '../src/utils/notesPayload.mjs')).href;

test('the notes API exposes the trash endpoints', () => {
  const constants = read('constants', 'api.js');
  assert.match(constants, /RESTORE: \(id\) => `\/api\/notes\/\$\{id\}\/restore`/);
  assert.match(constants, /TRASH: '\/api\/notes\/trash'/);

  const api = read('services', 'api', 'notesAPI.js');
  assert.match(api, /restore: \(id\) =>/);
  assert.match(api, /purge: \(id\) =>/);
  assert.match(api, /\?permanent=true/);
  assert.match(api, /emptyTrash: \(\) =>/);
});

test('the notes manager deletes softly, offers undo and drives the trash view', () => {
  const hook = read('hooks', 'useNotesManager.js');

  assert.match(hook, /const restoreNote = useCallback/);
  assert.match(hook, /const purgeNote = useCallback/);
  assert.match(hook, /const emptyTrash = useCallback/);
  // restoreNote must be defined before deleteNote uses it in the undo action.
  assert.ok(hook.indexOf('const restoreNote') < hook.indexOf('const deleteNote'));

  assert.match(hook, /showToast\(t\('noteMovedToTrash'\), 'success', \{/);
  assert.match(hook, /duration: 8000/);
  assert.match(hook, /action: \{ label: t\('undo'\), onClick: \(\) => restoreNote\(id\) \}/);

  // The trash view asks for deleted notes and drops the tag filter.
  assert.match(hook, /deleted: trashView \? 'true' : 'false'/);
  assert.match(hook, /if \(!trashView && stateRef\.current\.selectedTag\) params\.tag/);
  assert.match(hook, /trash: asNonNegativeNumber|trash: \(prev\.trash \|\| 0\) \+ 1/);
});

test('the payload normalizer carries the trash count', async () => {
  const { normalizeNotesPayload } = await import(payloadUrl);
  const normalized = normalizeNotesPayload({ counts: { active: 3, archived: 1, trash: 2 } });
  assert.deepEqual(normalized.counts, { active: 3, archived: 1, trash: 2 });

  const empty = normalizeNotesPayload({});
  assert.deepEqual(empty.counts, { active: 0, archived: 0, trash: 0 });
});

test('the sidebar exposes the trash entry with its count', () => {
  const sidebar = read('components', 'Sidebar.jsx');

  assert.match(sidebar, /trashCount/);
  assert.match(sidebar, /onShowTrashToggle/);
  assert.match(sidebar, /aria-label=\{t\('trash'\)\}/);
  assert.match(sidebar, /className=\{`sidebar-item \$\{showTrash \? 'active' : ''\}`\}/);
  // The "all notes" entry must leave the trash view.
  assert.match(sidebar, /onShowNotes/);
  assert.match(sidebar, /!selectedTag && !showArchived && !showTrash \? 'active' : ''/);
});

test('trash cards offer restore and purge only', () => {
  const note = read('components', 'Note.jsx');

  assert.match(note, /inTrash = false/);
  assert.match(note, /className="action-btn restore-btn"/);
  assert.match(note, /className="action-btn delete-btn purge-btn"/);
  // No editor, no dragging, no pin/archive/share inside the trash.
  assert.match(note, /onClick=\{\(\) => \{ if \(!inTrash && onOpenModal\) onOpenModal\(note\); \}\}/);
  assert.match(note, /draggable=\{inTrash \? 'false' : 'true'\}/);
  assert.match(note, /title=\{inTrash \? t\('confirmPurgeTitle'\) : t\('confirmDeleteNoteTitle'\)\}/);
  assert.match(note, /if \(inTrash\) \{\s*onPurge\(note\._id\);/);

  const list = read('components', 'NoteList.jsx');
  assert.match(list, /onRestore=\{onRestoreNote\}/);
  assert.match(list, /onPurge=\{onPurgeNote\}/);
  assert.match(list, /inTrash=\{Boolean\(inTrash\)\}/);

  const app = read('App.jsx');
  assert.match(app, /onRestoreNote: restoreNote, onPurgeNote: purgeNote/);
  assert.match(app, /inTrash: true/);
  assert.match(app, /<TrashHeader/);
});

test('toasts can carry an action button that dismisses on click', async () => {
  const { toastBus } = await import(toastBusUrl);
  let clicks = 0;

  toastBus.clear();
  const id = toastBus.publish('Gelöscht', 'success', 8000, { label: 'Rückgängig', onClick: () => { clicks += 1; } });
  assert.equal(toastBus.getToasts()[0].action.label, 'Rückgängig');
  assert.equal(typeof toastBus.getToasts()[0].action.onClick, 'function');
  assert.equal(toastBus.getToasts()[0].id, id);

  // An action without a handler or label is dropped instead of rendering a dead
  // button.
  toastBus.clear();
  toastBus.publish('ohne action', 'info', 3000, { label: 'X' });
  assert.equal(toastBus.getToasts()[0].action, null);
  toastBus.publish('ohne label', 'info', 3000, { onClick: () => {} });
  assert.equal(toastBus.getToasts()[1].action, null);

  const toast = read('components', 'Toast.jsx');
  assert.match(toast, /action = null/);
  assert.match(toast, /className="toast-action"/);
  assert.match(toast, /action\.onClick\(\);\s*onCloseRef\.current\(\);/);

  const stack = read('components', 'ToastStack.jsx');
  assert.match(stack, /action=\{toast\.action\}/);

  toastBus.clear();
  assert.equal(clicks, 0);
});

// Audit 2026-09-12 (Top-30 Nr. 10): "Papierkorb leeren" loeschte mit einem
// Klick alles endgueltig - ohne Bestaetigung und ohne Undo (der Undo-Toast
// deckt nur das einzelne Loeschen ab). Ein Fehlklick kostete damit bis zu
// 30 Tage geloeschter Notizen inklusive Bildern.
test('emptying the trash asks before deleting everything', () => {
  const states = read('components', 'AppStates.jsx');

  assert.match(states, /import ConfirmDialog from '\.\/ConfirmDialog';/);
  assert.match(states, /const \[confirmOpen, setConfirmOpen\] = useState\(false\);/);
  assert.match(states, /onClick=\{\(\) => setConfirmOpen\(true\)\}/, 'the button opens the dialog instead of deleting');
  assert.doesNotMatch(states, /className="btn-empty-trash"\n\s+onClick=\{onEmpty\}/, 'no direct delete on click');
  assert.match(states, /message=\{t\('emptyTrashConfirmMessage', \{ count \}\)\}/, 'the dialog names how many notes die');
  assert.match(states, /confirmLabel=\{t\('emptyTrashConfirm'\)\}/);
  assert.match(states, /onConfirm=\{\(\) => \{\s*setConfirmOpen\(false\);\s*onEmpty\?\.\(\);\s*\}\}/);
  assert.match(states, /onCancel=\{\(\) => setConfirmOpen\(false\)\}/);
  assert.match(states, /aria-haspopup="dialog"/);

  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    for (const key of ['emptyTrashConfirmTitle', 'emptyTrashConfirmMessage', 'emptyTrashConfirm']) {
      assert.match(translations, new RegExp(`${key}:`), `${file} must translate ${key}`);
    }
    assert.match(translations, /emptyTrashConfirmMessage: '[^']*\{count\}/, `${file} must interpolate the count`);
  }
});
