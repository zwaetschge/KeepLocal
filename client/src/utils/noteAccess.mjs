// Ownership helpers for notes.
//
// Shared notes are collaborative: the owner and everyone in `sharedWith` may
// edit content/title/tags/colour and toggle the pin. Destructive or structural
// operations stay owner-only on the server (delete, archive, share/unshare,
// image upload, transcription), so the UI must not offer them to collaborators —
// otherwise every click answers with a confusing 404 "Notiz nicht gefunden".
//
// Plain module (no React) so `node --test` can exercise it directly.

/**
 * Extract the owner id from a note. `userId` arrives either as an ObjectId
 * string (v1 API) or as a populated `{ _id, username, email }` object.
 * @param {Object|null|undefined} note
 * @returns {string|null}
 */
export function noteOwnerId(note) {
  const raw = note?.userId;
  if (!raw) return null;
  if (typeof raw === 'object') {
    const id = raw._id || raw.id;
    return id ? String(id) : null;
  }
  return String(raw);
}

/**
 * Whether the given user owns the note.
 * @param {Object|null|undefined} note
 * @param {Object|null|undefined} user - auth context user (`{ id }`) or `{ _id }`
 * @returns {boolean}
 */
export function isNoteOwner(note, user) {
  const owner = noteOwnerId(note);
  const me = user?.id || user?._id;
  if (!owner || !me) return false;
  return owner === String(me);
}

/**
 * Display name of the note owner, for the "shared by" hint. Falls back to the
 * email local part when no username is populated.
 * @param {Object|null|undefined} note
 * @returns {string|null}
 */
export function noteOwnerName(note) {
  const raw = note?.userId;
  if (!raw || typeof raw !== 'object') return null;
  return raw.username || (typeof raw.email === 'string' ? raw.email.split('@')[0] : null) || null;
}

const noteAccess = { noteOwnerId, isNoteOwner, noteOwnerName };
export default noteAccess;
