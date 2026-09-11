const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const componentSource = (file) =>
  fs.readFileSync(path.join(__dirname, '../src/components', file), 'utf8');

// P18: native alert()/window.confirm() block the whole UI, are untestable and
// drop server error details. Regression guard for the components that used them.
test('NoteModal and FriendsModal no longer use native alert()/confirm()', () => {
  for (const file of ['NoteModal.jsx', 'FriendsModal.jsx']) {
    const source = componentSource(file);
    assert.doesNotMatch(source, /(^|[^.\w])alert\(/, `${file} still calls alert()`);
    assert.doesNotMatch(source, /window\.confirm\(/, `${file} still calls window.confirm()`);
    assert.match(source, /toastBus/, `${file} should report via the toast bus`);
  }
});

// P5b: edits send baseUpdatedAt (optimistic locking); the conflict banner
// offers both resolutions and force-overwrite omits baseUpdatedAt.
test('NoteModal sends baseUpdatedAt on edits and offers both conflict resolutions', () => {
  const source = componentSource('NoteModal.jsx');

  assert.match(source, /payload\.baseUpdatedAt = baseUpdatedAtRef\.current/);
  // PUT only — guarded behind an existing note and not forced.
  assert.match(source, /if \(note && !forceOverwrite && baseUpdatedAtRef\.current\)/);
  assert.match(source, /saveNote\(\{ force: true \}\)/);
  assert.match(source, /isNoteConflictError/);
  assert.match(source, /notesAPI\.getById/);
  assert.match(source, /conflictLoadServerVersion/);
  assert.match(source, /conflictOverwriteMine/);
  assert.match(source, /conflictDiscardTitle/);
});

test('NoteModal does not blindly trust the 409 body from apiUtils', () => {
  const source = componentSource('NoteModal.jsx');

  // apiUtils throws plain Errors (no status), so the modal additionally probes
  // the server version when a save silently failed.
  assert.match(source, /error\.status === 409/);
  assert.match(source, /detectConflictAfterFailedSave/);
});

// P19a: real overlays are dialogs with focus management.
test('modals expose dialog semantics and use the shared a11y hook', () => {
  const expectations = [
    ['NoteModal.jsx', 'note-modal', 'sr-only'],
    ['FriendsModal.jsx', 'friends-modal', 'friends-modal-header'],
    ['CollaborateModal.jsx', 'collaborate-modal', 'collaborate-modal-header'],
    ['Settings.jsx', 'settings-modal', 'settings-header'],
    ['ConfirmDialog.jsx', 'confirm-dialog', 'confirm-dialog-title'],
    // BUG_REPORT_2026-09-10 #9: the admin console was the only overlay without
    // dialog semantics — no role, no focus trap, and Escape did not close it.
    ['AdminConsole.jsx', 'admin-console', 'admin-console-header'],
  ];

  for (const [file, containerClass, labelAnchor] of expectations) {
    const source = componentSource(file);
    assert.match(source, new RegExp(`className="${containerClass}"`), `${file} container`);
    assert.match(source, /role="dialog"/, `${file} role="dialog"`);
    assert.match(source, /aria-modal="true"/, `${file} aria-modal`);
    assert.match(source, /aria-labelledby=\{titleId\}/, `${file} aria-labelledby`);
    assert.match(source, /useModalA11y\(/, `${file} uses useModalA11y`);
    assert.match(source, new RegExp(labelAnchor), `${file} labels the dialog`);
  }
});

test('overlays that close on backdrop clicks use the drag-safe guard', () => {
  // BUG_REPORT_2026-09-10 #5: releasing a text selection on the backdrop must
  // not count as a backdrop click. (The lightbox inside NoteModal keeps a plain
  // onClick on purpose: it only closes an image viewer, no form is at stake.)
  const overlays = [
    ['NoteModal.jsx', 'note-modal-overlay'],
    ['AdminConsole.jsx', 'admin-console-overlay'],
    ['FriendsModal.jsx', 'modal-overlay'],
    ['CollaborateModal.jsx', 'modal-overlay'],
    ['Settings.jsx', 'settings-overlay'],
  ];

  for (const [file, overlayClass] of overlays) {
    const source = componentSource(file);
    assert.match(source, /useBackdropClose\(/, `${file} imports the guard`);
    assert.match(
      source,
      new RegExp(`className="${overlayClass}" \\{\\.\\.\\.backdropClose\\}`),
      `${file} spreads the guard on .${overlayClass}`
    );
    assert.doesNotMatch(
      source,
      new RegExp(`className="${overlayClass}" onClick=`),
      `${file} still closes .${overlayClass} on a raw onClick`
    );
  }
});

test('useModalA11y is only consumed via direct imports (not hooks/index.js)', () => {
  const hookSource = fs.readFileSync(
    path.join(__dirname, '../src/hooks/useModalA11y.js'),
    'utf8'
  );
  assert.match(hookSource, /export function useModalA11y/);
  assert.match(hookSource, /computeTrapFocus/);

  const indexSource = fs.readFileSync(
    path.join(__dirname, '../src/hooks/index.js'),
    'utf8'
  );
  assert.doesNotMatch(indexSource, /useModalA11y/);
});

// P19b: toasts announce themselves to assistive tech.
test('Toast uses aria-live and switches to role=alert for errors', () => {
  const source = componentSource('Toast.jsx');

  assert.match(source, /role=\{isAssertive \? 'alert' : 'status'\}/);
  assert.match(source, /aria-live=\{isAssertive \? 'assertive' : 'polite'\}/);
});

// P14b: editor grid uses thumbnails and lazy loading; the lightbox keeps the
// full-size URL.
test('NoteModal image grid prefers thumbnails and loads lazily', () => {
  const source = componentSource('NoteModal.jsx');

  assert.match(source, /image\.thumbnailUrl \|\| image\.url/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /decoding="async"/);
  // Lightbox still opens the full resolution image.
  assert.match(source, /url: images\[index\]\.url/);
});

// P15c: clipboard copy has an HTTP-safe fallback and reports via toast.
test('Settings copies API keys with a fallback and toast feedback', () => {
  const source = componentSource('Settings.jsx');

  assert.match(source, /copyToClipboard\(createdKey\)/);
  assert.match(source, /copyToClipboardFailed/);
  assert.doesNotMatch(source, /navigator\.clipboard/);
});

// B2: FriendsModal must not share one loading flag across independent requests.
test('FriendsModal keeps separate loading flags for list, requests and search', () => {
  const source = componentSource('FriendsModal.jsx');

  assert.match(source, /loadingFriends/);
  assert.match(source, /loadingRequests/);
  assert.match(source, /searching/);
  assert.doesNotMatch(source, /const \[loading, setLoading\]/);
});
