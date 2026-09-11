const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// BUG_REPORT_2026-09-10 #1: the recorder cleanup dereferenced an empty ref
// (`null?.state !== 'inactive'` is true), so EVERY NoteModal unmount threw a
// TypeError and the ErrorBoundary replaced the whole app. In dev/StrictMode it
// fired on mount, i.e. as soon as the editor opened.
test('the note editor cleanup survives an unused media recorder', () => {
  const source = read('components', 'NoteModal.jsx');
  const cleanup = source.split('useEffect(() => () => {')[1].split('}, []);')[0];

  assert.match(cleanup, /const recorder = mediaRecorderRef\.current;/);
  assert.match(cleanup, /if \(recorder && recorder\.state !== 'inactive'\)/);
  assert.doesNotMatch(
    cleanup,
    /if \(mediaRecorderRef\.current\?\.state !== 'inactive'\)/,
    'an optional-chain guard alone still dereferences null on the next line'
  );
});

// #5: selecting text in the editor and releasing over the backdrop used to
// save-and-close (and silently drop a title-only note).
test('the note editor backdrop ignores clicks that started inside the modal', () => {
  const source = read('components', 'NoteModal.jsx');

  assert.match(source, /import \{ useBackdropClose \} from '\.\.\/hooks\/useBackdropClose';/);
  assert.match(source, /const backdropClose = useBackdropClose\(handleOverlayClick\);/);
  assert.match(source, /<div className="note-modal-overlay" \{\.\.\.backdropClose\}>/);
  assert.doesNotMatch(source, /className="note-modal-overlay" onClick=\{handleOverlayClick\}/);
});

// #6: uploading or deleting an image bumps the stored note; without refreshing
// baseUpdatedAt the next save is a false 409 conflict against the app itself.
test('image mutations refresh the optimistic-locking baseline', () => {
  const source = read('components', 'NoteModal.jsx');
  const upload = source.split('notesAPI.uploadImages(')[1].split('};')[0];
  const remove = source.split('notesAPI.deleteImage(')[1].split('};')[0];

  assert.match(upload, /baseUpdatedAtRef\.current = updatedNote\.updatedAt/);
  assert.match(remove, /baseUpdatedAtRef\.current = updatedNote\.updatedAt/);
});

// #7: `mountedRef` was only ever set to false. React 18 StrictMode runs
// mount → cleanup → mount, so in `npm run dev` the hook stayed "unmounted" and
// dropped every fetched link preview.
test('useLinkPreview re-arms its mounted flag on every mount', () => {
  const source = read('hooks', 'useLinkPreview.js');
  const lifecycle = source.split('// Cleanup on unmount')[1];

  assert.match(lifecycle, /mountedRef\.current = true;/);
  assert.match(lifecycle, /mountedRef\.current = false;/);

  // useAsync had the same trap and already resets the flag; keep them in sync.
  assert.match(read('hooks', 'useAsync.js'), /mountedRef\.current = true;/);
});
