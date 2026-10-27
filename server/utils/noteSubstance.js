/** A title, a checklist item or an attachment is a complete note too. */
function hasNoteSubstance(note = {}) {
  return Boolean(
    (typeof note.title === 'string' && note.title.trim()) ||
      (!note.isTodoList &&
        typeof note.content === 'string' &&
        note.content.trim()) ||
      (note.isTodoList &&
        note.todoItems?.some(
          (item) => typeof item.text === 'string' && item.text.trim(),
        )) ||
      note.images?.length ||
      note.files?.length ||
      note.features?.drawing?.strokes?.length ||
      note.features?.audio?.length,
  );
}
module.exports = { hasNoteSubstance };
