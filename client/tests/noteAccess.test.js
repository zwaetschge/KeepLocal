const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// BUG_REPORT_2026-09-10 (Runde 3) #2: shared notes are collaborative for
// content edits, but archive/delete/share/uploads/transcription stay with the
// owner. The UI derives that from noteAccess.mjs, so the helper has to be exact.
const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/noteAccess.mjs')).href;

const OWNER = '507f191e810c19729de860ea';
const OTHER = '507f191e810c19729de860eb';

test('the owner id is read from a populated or a plain userId', async () => {
  const { noteOwnerId } = await import(moduleUrl);

  assert.equal(noteOwnerId({ userId: OWNER }), OWNER);
  assert.equal(noteOwnerId({ userId: { _id: OWNER, username: 'alice' } }), OWNER);
  assert.equal(noteOwnerId({ userId: { id: OWNER } }), OWNER);
  assert.equal(noteOwnerId({ userId: null }), null);
  assert.equal(noteOwnerId({}), null);
  assert.equal(noteOwnerId(null), null);
});

test('ownership is true only for the owner', async () => {
  const { isNoteOwner } = await import(moduleUrl);
  const populated = { userId: { _id: OWNER, username: 'alice' }, sharedWith: [{ _id: OTHER }] };
  const plain = { userId: OWNER };

  assert.equal(isNoteOwner(populated, { id: OWNER }), true);
  assert.equal(isNoteOwner(plain, { id: OWNER }), true);
  assert.equal(isNoteOwner(populated, { _id: OWNER }), true, 'accepts a _id-shaped user too');
  assert.equal(isNoteOwner(populated, { id: OTHER }), false);
  assert.equal(isNoteOwner(populated, null), false);
  assert.equal(isNoteOwner(null, { id: OWNER }), false);
});

test('the last editor is reported only when it is not the owner', async () => {
  const { lastEditorName } = await import(moduleUrl);

  assert.equal(
    lastEditorName({ userId: { _id: OWNER }, lastEditedBy: { _id: OTHER, username: 'bob' } }),
    'bob'
  );
  assert.equal(
    lastEditorName({ userId: { _id: OWNER }, lastEditedBy: OWNER }),
    null,
    'the owner editing their own note needs no hint'
  );
  assert.equal(lastEditorName({ userId: { _id: OWNER } }), null);
  assert.equal(
    lastEditorName({ userId: { _id: OWNER }, lastEditedBy: { _id: OTHER, email: 'bob@example.com' } }),
    'bob',
    'falls back to the email local part'
  );
  assert.equal(lastEditorName({ userId: { _id: OWNER }, lastEditedBy: OTHER }), null,
    'a bare id without a populated user cannot be named');
});

test('the owner name falls back to the email local part', async () => {
  const { noteOwnerName } = await import(moduleUrl);

  assert.equal(noteOwnerName({ userId: { username: 'alice', email: 'alice@example.com' } }), 'alice');
  assert.equal(noteOwnerName({ userId: { email: 'alice@example.com' } }), 'alice');
  assert.equal(noteOwnerName({ userId: { username: '', email: '' } }), null);
  assert.equal(noteOwnerName({ userId: OWNER }), null);
});
