const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const readPublic = (file) => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');

// BUG_REPORT_2026-09-10 (Runde 3) #1: Ctrl+N (and the "new note" button) must
// not hijack an already open editor. `noteModal.note` would flip to null while
// the form still shows the open note's values, so saving created a duplicate
// instead of updating the note.
test('a new-note request never replaces an open editor', () => {
  const app = read('App.jsx');

  assert.match(app, /setNoteModal\(prev => \(prev\.isOpen \? prev : \{ isOpen: true, note \}\)\)/);
  assert.doesNotMatch(app, /const openNoteModal = \(note = null\) => setNoteModal\(\{ isOpen: true, note \}\)/);
});

// #2: owner-only actions must not be offered to collaborators (the server
// answers 404 for them), while content editing stays available.
test('note cards offer destructive actions to the owner only', () => {
  const note = read('components', 'Note.jsx');

  assert.match(note, /import \{ isNoteOwner, lastEditorName \} from '\.\.\/utils\/noteAccess\.mjs';/);
  assert.match(note, /const canManage = isNoteOwner\(note, user\);/);
  assert.match(note, /\{canManage && \(\s*<button[^>]*onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*onToggleArchive/s);
  assert.match(note, /\{canManage && onOpenCollaborate && \(/);
  assert.match(note, /const editorName = lastEditorName\(note\);/);
  assert.match(note, /className="note-edited-by"/);
  assert.match(note, /\{canManage && \(\s*<button[^>]*onClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*handleDeleteClick\(\);/s);
  // Pinning stays collaborative (the server allows it for sharedWith).
  assert.match(note, /onTogglePin\(note\._id\)/);
});

test('the note editor hides owner-only tools and explains the shared state', () => {
  const modal = read('components', 'NoteModal.jsx');

  assert.match(modal, /const canManage = !note \|\| isNoteOwner\(note, user\);/);
  // Destructural/strukturell bleibt beim Besitzer ...
  assert.match(modal, /\{note && canManage && onToggleArchive && \(/);
  assert.match(modal, /\{note && canManage && onOpenCollaborate && \(/);
  assert.match(modal, /\{note && canManage && onDelete && \(/);
  // ... Inhaltliches (Bilder, Aufnahme) dürfen Mitbearbeiter ebenfalls,
  // passend zu den Server-Routen (requireEditableNote).
  assert.match(modal, /\{!isDemo && note && settings\.aiFeatures\.voiceTranscription/);
  assert.doesNotMatch(modal, /\{!isDemo && note && canManage && settings\.aiFeatures/);
  assert.match(modal, /\{!isDemo && note && images && images\.length > 0 && \(/);
  assert.doesNotMatch(modal, /\{canManage && \(\s*<button\s*type="button"\s*className="image-delete-btn"/);

  assert.match(modal, /note-modal-shared-hint/);
  assert.match(modal, /t\('sharedNoteOwnerHint', \{ owner: noteOwnerName\(note\) \|\| t\('unknownUser'\) \}\)/);
  // Nachvollziehbarkeit: wer zuletzt geändert hat.
  assert.match(modal, /const editorName = lastEditorName\(serverNote \|\| note\);/);
  assert.match(modal, /t\('lastEditedBy', \{ name: editorName \}\)/);
  assert.match(modal, /note-modal-edited-hint/);
});

test('an editor opened while somebody else saves offers the conflict banner', () => {
  const modal = read('components', 'NoteModal.jsx');
  const app = read('App.jsx');

  // App reicht die live-Version aus der Liste durch (Poll/Focus-Refresh).
  assert.match(app, /serverNote=\{noteModal\.note \? \(notes\.find\(item => item\._id === noteModal\.note\._id\) \|\| noteModal\.note\) : null\}/);
  // NoteModal vergleicht sie gegen die eigene Basis statt still zu überschreiben.
  assert.match(modal, /const serverUpdatedAt = serverNote\?\.updatedAt;/);
  assert.match(modal, /if \(serverUpdatedAt === baseUpdatedAtRef\.current\) return;/);
  assert.match(modal, /setConflict\(previous => \(previous \? previous : \{ currentNote: serverNote \}\)\);/);
});

// #4: the collaborate modal kept reading the note from props, which App never
// refreshes — the button stayed on "Share" after a successful share and a
// second click silently unshared the note.
test('the collaborate modal tracks its own note state after sharing', () => {
  const modal = read('components', 'CollaborateModal.jsx');

  assert.match(modal, /const \[currentNote, setCurrentNote\] = useState\(note\);/);
  assert.match(modal, /useEffect\(\(\) => \{\s*setCurrentNote\(note\);\s*\}, \[note\]\);/);
  assert.equal(modal.match(/setCurrentNote\(updatedNote\)/g)?.length, 2, 'share and unshare both refresh the local note');
  assert.match(modal, /const sharedWithIds = currentNote\?\.sharedWith/);
  assert.match(modal, /\{isOpen && currentNote && \(/);
  assert.doesNotMatch(modal, /notesAPI\.shareNote\(note\._id/);
});

// #8: after the OAuth redirect the callback screen must stay until the session
// is loaded, otherwise the login form flashes for the duration of /api/auth/me.
test('the OAuth callback stays mounted until the session resolves', () => {
  const app = read('App.jsx');
  const callback = read('components', 'OAuthCallback.jsx');

  assert.match(app, /useState\(\(\) => getBrowserPathname\(\) === '\/oauth\/callback'\)/);
  assert.match(app, /if \(oauthCallback\) \{/);
  assert.doesNotMatch(app, /if \(getBrowserPathname\(\) === '\/oauth\/callback'\) \{/);
  assert.equal(app.match(/setOauthCallback\(false\)/g)?.length, 2, 'both success and failure leave the callback screen');

  // The effect must not re-run when AppContent re-renders (inline callback prop),
  // otherwise it re-reads an already cleaned URL and flags a failed login.
  assert.match(callback, /const handledRef = useRef\(false\);/);
  assert.match(callback, /if \(handledRef\.current\) return undefined;/);
  assert.match(callback, /\}, \[\]\);/);
});

// #9: the service worker's offline answer must stay language-neutral so callers
// fall back to their translated messages.
test('offline API responses carry a code instead of a hardcoded language', () => {
  const worker = readPublic('service-worker.js');
  const apiUtils = read('services', 'api', 'apiUtils.js');

  assert.match(worker, /JSON\.stringify\(\{ code: 'OFFLINE' \}\)/);
  assert.doesNotMatch(worker, /Offline - API nicht verfügbar/);
  // Die Bau-Logik liegt in utils/httpErrors.mjs (mit node --test ausführbar),
  // apiUtils reicht sie durch.
  const httpErrors = read('utils', 'httpErrors.mjs');
  assert.match(httpErrors, /payload\.error \|\| \(payload\.code \? '' : \(fallbackMessage \|\| `HTTP \$\{status\}`\)\)/);
  assert.match(httpErrors, /error\.code = payload\.code;/);
  assert.match(apiUtils, /buildHttpError\(\{ status, payload \}\)/);
});

// Audit 2026-09-12 (Top-30 Nr. 2): "Freund entfernen" widerruft serverseitig
// `sharedWith` in beiden Richtungen. Die UI muss danach nachziehen, sonst zeigt
// die Notizkarte bis zum nächsten 60-Sekunden-Poll einen Mitbearbeiter, der
// längst keinen Zugriff mehr hat.
test('removing a friend refreshes the notes instead of waiting for the poll', () => {
  const modal = read('components', 'FriendsModal.jsx');
  const app = read('App.jsx');

  assert.match(modal, /function FriendsModal\(\{ isOpen, onClose, isAdmin, onFriendsChanged \}\)/);
  assert.match(
    modal,
    /await friendsAPI\.removeFriend\(friendId\);[\s\S]{0,400}?onFriendsChanged\?\.\(\);/,
    'the callback must fire after a successful removal'
  );
  assert.match(
    app,
    /onFriendsChanged=\{\(\) => fetchNotes\(searchTerm, pagination\.page, \{ background: true \}\)\}/,
    'App must refresh in the background (no spinner, no scroll reset)'
  );
});
