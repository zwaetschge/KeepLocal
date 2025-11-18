/**
 * Notes Service
 * Business logic for note operations
 * Extracted from routes for better maintainability and testability
 */

const Note = require('../models/Note');
const { errorMessages } = require('../constants');

/**
 * Build query for fetching notes
 * @param {Object} params - Query parameters
 * @param {string} params.userId - User ID
 * @param {string} params.search - Search term
 * @param {string} params.tag - Tag filter
 * @param {boolean} params.isArchived - Archived filter
 * @returns {Object} MongoDB query object
 */
function buildNotesQuery({ userId, search, tag, isArchived = false }) {
  // Query for own and shared notes
  let query = {
    $or: [
      { userId: userId }, // Own notes
      { sharedWith: userId } // Shared notes
    ],
    isArchived: isArchived
  };

  // Full-text search using MongoDB text index (more performant than regex)
  if (search && search.trim() !== '') {
    // MongoDB $text search is indexed and much faster than regex
    // It searches in title, content, and todoItems.text (as defined in the model)
    query.$text = { $search: search.trim() };
  }

  // Filter by tag
  if (tag && tag.trim() !== '') {
    query.tags = tag.toLowerCase();
  }

  return query;
}

/**
 * Get all notes with optional filtering and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Notes and pagination info
 */
async function getAllNotes({ userId, search, tag, page = 1, limit = 50, archived = 'false' }) {
  const isArchived = archived === 'true';
  const query = buildNotesQuery({ userId, search, tag, isArchived });

  // Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const total = await Note.countDocuments(query);

  const notes = await Note.find(query)
    .populate('userId', 'username email')
    .populate('sharedWith', 'username email')
    .sort({ isPinned: -1, createdAt: -1 }) // Pinned notes first
    .skip(skip)
    .limit(parseInt(limit));

  return {
    notes,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit))
    }
  };
}

/**
 * Get a single note by ID
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Note object
 * @throws {Error} If note not found or no access
 */
async function getNoteById(noteId, userId) {
  const note = await Note.findOne({
    _id: noteId,
    $or: [
      { userId: userId },
      { sharedWith: userId }
    ]
  }).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Create a new note
 * @param {Object} noteData - Note data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Created note
 */
async function createNote(noteData, userId) {
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews } = noteData;

  const newNote = new Note({
    title: title || '',
    content: isTodoList ? '' : (content?.trim() || ''),
    color: color || '#ffffff',
    isPinned: isPinned || false,
    tags: tags || [],
    isTodoList: isTodoList || false,
    todoItems: isTodoList ? (todoItems || []) : [],
    linkPreviews: linkPreviews || [],
    userId: userId
  });

  const savedNote = await newNote.save();
  return savedNote;
}

/**
 * Update an existing note
 * @param {string} noteId - Note ID
 * @param {Object} noteData - Updated note data
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 * @throws {Error} If note not found or no access
 */
async function updateNote(noteId, noteData, userId) {
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews } = noteData;

  // Build update object with only the provided fields
  const updateData = {};
  if (title !== undefined) updateData.title = title;
  if (content !== undefined) updateData.content = isTodoList ? '' : (content?.trim() || '');
  if (color !== undefined) updateData.color = color;
  if (isPinned !== undefined) updateData.isPinned = isPinned;
  if (tags !== undefined) updateData.tags = tags;
  if (isTodoList !== undefined) updateData.isTodoList = isTodoList;
  if (todoItems !== undefined) updateData.todoItems = todoItems;
  if (linkPreviews !== undefined) updateData.linkPreviews = linkPreviews;

  // Only update own notes
  const updatedNote = await Note.findOneAndUpdate(
    { _id: noteId, userId: userId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!updatedNote) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return updatedNote;
}

/**
 * Delete a note
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Deleted note
 * @throws {Error} If note not found or no access
 */
async function deleteNote(noteId, userId) {
  const deletedNote = await Note.findOneAndDelete({
    _id: noteId,
    userId: userId
  });

  if (!deletedNote) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return deletedNote;
}

/**
 * Toggle pin status of a note
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 */
async function togglePinNote(noteId, userId) {
  const note = await Note.findOne({
    _id: noteId,
    userId: userId
  });

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  note.isPinned = !note.isPinned;
  await note.save();

  return note;
}

/**
 * Toggle archive status of a note
 * @param {string} noteId - Note ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Updated note
 */
async function toggleArchiveNote(noteId, userId) {
  const note = await Note.findOne({
    _id: noteId,
    userId: userId
  });

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  note.isArchived = !note.isArchived;
  await note.save();

  return note;
}

/**
 * Share a note with another user
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} targetUserId - User ID to share with
 * @returns {Promise<Object>} Updated note
 */
async function shareNote(noteId, userId, targetUserId) {
  // Use atomic operation to prevent race conditions
  // $addToSet ensures no duplicates even with concurrent requests
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $addToSet: { sharedWith: targetUserId }
    },
    {
      new: true, // Return updated document
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

/**
 * Unshare a note from a user
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} targetUserId - User ID to unshare from
 * @returns {Promise<Object>} Updated note
 */
async function unshareNote(noteId, userId, targetUserId) {
  // Use atomic operation to prevent race conditions
  // $pull removes the user ID from the array
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $pull: { sharedWith: targetUserId }
    },
    {
      new: true, // Return updated document
      runValidators: true
    }
  ).populate('userId', 'username email')
    .populate('sharedWith', 'username email');

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return note;
}

module.exports = {
  getAllNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  togglePinNote,
  toggleArchiveNote,
  shareNote,
  unshareNote,
  buildNotesQuery, // Export for testing
};
