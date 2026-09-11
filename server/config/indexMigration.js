/**
 * One-off index migration, run before mongoose builds the schema indexes.
 *
 * MongoDB allows exactly ONE text index per collection. Adding weights to the
 * note search therefore cannot be expressed as "another index": createIndex would
 * fail with "An equivalent index already exists with a different name and
 * options", model.init() would reject, and the server would refuse to start on
 * every existing deployment. So a text index that does not match the current
 * definition is dropped first — idempotently, and only for the note fields.
 *
 * Note that MongoDB fills in `weights: {title: 1, content: 1, 'todoItems.text': 1}`
 * and `default_language: 'english'` for an index created without options, so the
 * legacy version cannot be detected by "has no weights".
 */

const TEXT_INDEX_KEYS = ['title', 'content', 'todoItems.text'];

/** Must match the definition in models/Note.js. */
const TARGET_INDEX_NAME = 'note_text_search';
const TARGET_WEIGHTS = { title: 5, content: 1, 'todoItems.text': 2 };
const TARGET_LANGUAGE = 'none';

/**
 * @param {Object} indexDefinition - as returned by collection.indexes()
 * @returns {boolean} true for a text index over exactly the note search fields
 */
function isNoteTextIndex(indexDefinition) {
  const key = indexDefinition?.key;
  // Text indexes report their key as { _fts: 'text', _ftsx: 1 }; the covered
  // fields only appear in `weights` (MongoDB fills in 1 for every field when the
  // index was created without explicit weights).
  if (!key || key._fts !== 'text' || key._ftsx !== 1) return false;
  const fields = Object.keys(indexDefinition.weights || {});
  return fields.length === TEXT_INDEX_KEYS.length
    && TEXT_INDEX_KEYS.every(field => fields.includes(field));
}

/**
 * @param {Object} indexDefinition
 * @returns {boolean} true when the index already matches the current schema
 */
function isCurrentTextIndex(indexDefinition) {
  if (indexDefinition.name !== TARGET_INDEX_NAME) return false;
  if (indexDefinition.default_language !== TARGET_LANGUAGE) return false;
  const weights = indexDefinition.weights;
  if (!weights) return false;
  return TEXT_INDEX_KEYS.every(field => weights[field] === TARGET_WEIGHTS[field]);
}

/**
 * Drop an outdated note text index so the weighted one can be created.
 *
 * @param {import('mongoose').Connection} connection
 * @returns {Promise<{dropped: string|null, reason: string}>}
 */
async function ensureNoteTextIndex(connection) {
  const collection = connection.collection('notes');

  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    // A brand-new database has no collection yet — nothing to migrate.
    return { dropped: null, reason: `no indexes readable (${error.message})` };
  }

  const outdated = indexes.find(definition => isNoteTextIndex(definition) && !isCurrentTextIndex(definition));
  if (!outdated) {
    const current = indexes.find(definition => isNoteTextIndex(definition) && isCurrentTextIndex(definition));
    return { dropped: null, reason: current ? 'text index is current' : 'no text index yet' };
  }

  await collection.dropIndex(outdated.name);
  return { dropped: outdated.name, reason: 'outdated text index dropped' };
}

module.exports = {
  ensureNoteTextIndex,
  isNoteTextIndex,
  isCurrentTextIndex,
  TEXT_INDEX_KEYS,
  TARGET_INDEX_NAME,
  TARGET_WEIGHTS,
  TARGET_LANGUAGE
};
