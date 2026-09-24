const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// v1.14.0 Nr. 7 „Revisions-Historie ohne UI": Der Server speichert seit v1.13.0
// Fassungen, aber kein Client zeigte sie. Hier wird die Verdrahtung gepinnt:
// API-Client, Komponente, Modal-Einbindung, Restore-Baseline und i18n.

test('notesAPI exposes the three revision calls against the documented endpoints', () => {
  const source = read('services', 'api', 'notesAPI.js');

  assert.match(source, /getRevisions: \(id, options = \{\}\) =>\s*\n\s*fetchWithAuth\(API_ENDPOINTS\.NOTES\.REVISIONS\(id\)/);
  assert.match(
    source,
    /getRevision: \(id, at, options = \{\}\) =>\s*\n\s*fetchWithAuth\(`\$\{API_ENDPOINTS\.NOTES\.REVISIONS\(id\)\}\?at=\$\{encodeURIComponent\(at\)\}`/
  );
  assert.match(
    source,
    /restoreRevision: \(id, at, baseUpdatedAt\) =>\s*\n\s*fetchWithAuth\(API_ENDPOINTS\.NOTES\.RESTORE_REVISION\(id\), \{\s*\n\s*method: 'POST',\s*\n\s*body: JSON\.stringify\(baseUpdatedAt \? \{ at, baseUpdatedAt \} : \{ at \}\),/
  );

  const endpoints = read('constants', 'api.js');
  assert.match(endpoints, /REVISIONS: \(id\) => `\/api\/notes\/\$\{id\}\/revisions`/);
  assert.match(endpoints, /RESTORE_REVISION: \(id\) => `\/api\/notes\/\$\{id\}\/revisions\/restore`/);
});

test('NoteHistory loads lazily, previews on demand and restores through the API', () => {
  const source = read('components', 'NoteHistory.jsx');

  // Liste erst beim ersten Öffnen — nicht beim Modal-Open für jeden Editor.
  assert.match(source, /if \(!wasOpen && revisions === null && !listError\)/);
  // Vorschau nur auf Klick (?at=), nicht für alle Einträge vorab.
  assert.match(source, /notesAPI\.getRevision\(noteId, savedAt\)/);
  // Restore schickt exakt das savedAt zurück, das die Liste lieferte — und
  // seit v1.18.0 die Edit-Baseline des Modals dazu (409 statt still kopieren).
  assert.match(source, /notesAPI\.restoreRevision\(\s*\n\s*noteId,\s*\n\s*preview\.savedAt,\s*\n\s*baseUpdatedAtRef\?\.current \?\? undefined\s*\n\s*\)/);
  // Nach dem Restore wird die Liste neu gelesen: der alte Stand ist selbst
  // eine neue Revision geworden.
  assert.match(source, /\/\/ Der aktuelle Stand ist jetzt selbst die jüngste Revision/);
});

test('the modal applies the restored note and refreshes the locking baseline', () => {
  const source = read('components', 'NoteModal.jsx');
  const handler = source.split('const handleRevisionRestored')[1].split('}, [setTodoItems, onRestored]);')[0];

  assert.match(handler, /setTitle\(updatedNote\.title \|\| ''\)/);
  assert.match(handler, /setContent\(updatedNote\.content \|\| ''\)/);
  assert.match(handler, /setIsTodoList\(Boolean\(updatedNote\.isTodoList\)\)/);
  assert.match(handler, /setConflict\(null\)/);
  // Ohne diesen Ref-Refresh 409-t der nächste manuelle Save gegen den Stand
  // VOR dem Restore (gleiche Lehre wie fileAttachmentsUi-Test).
  assert.match(handler, /baseUpdatedAtRef\.current = updatedNote\.updatedAt \|\| null;/);

  // Historie nur für echte Notizen und nicht für Demo (Server blockt Restore
  // via rejectDemoNoteCapabilities — die UI verspricht nichts Unmögliches).
  assert.match(
    source,
    /\{!isDemo && note && \(\s*\n\s*<NoteHistory\s*\n\s*noteId=\{note\._id\}\s*\n\s*onRestored=\{handleRevisionRestored\}\s*\n\s*baseUpdatedAtRef=\{baseUpdatedAtRef\}\s*\n\s*\/>/
  );
});

test('App refreshes the list in the background after a restore, without growing past the line guard', () => {
  const source = read('App.jsx');
  assert.match(
    source,
    /onSave=\{handleModalSave\} onClose=\{closeNoteModal\} onRestored=\{\(\) => fetchNotes\(searchTerm, pagination\.page, \{ background: true \}\)\}/
  );
  // Der Guard ist strikt < 520 (wie wc -l gezählt, s. notesManagerLogic):
  // eine eigene Zeile für onRestored würde ihn brechen — das Prop muss auf
  // einer bestehenden Zeile reisen.
  const lineCount = source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
  assert.ok(lineCount < 520, `App.jsx at ${lineCount} lines breaks the < 520 guard`);
});

test('the history catalog keys exist in both languages', () => {
  for (const file of ['de.js', 'en.js']) {
    const source = read('translations', file);
    for (const key of [
      'noteHistory', 'noteHistoryEmpty', 'noteHistoryLoadFailed', 'noteHistoryPreviewFailed',
      'noteHistoryRestoreFailed', 'noteHistoryRestore', 'noteHistoryRestoring', 'noteHistoryRestored',
      'noteHistoryUntitled', 'noteHistoryTodo', 'noteHistoryChars',
    ]) {
      assert.match(source, new RegExp(`^  ${key}:`, 'm'), `${file} fehlt ${key}`);
    }
  }
});
