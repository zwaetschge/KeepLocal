/**
 * Notes Service
 * Business logic for note operations
 * Extracted from routes for better maintainability and testability
 */

const Note = require('../models/Note');
const User = require('../models/User');
const { errorMessages } = require('../constants');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

/**
 * Helper function: Generate thumbnail for an uploaded image
 * @param {string} filename - Original image filename
 * @param {string} filepath - Full path to the original image
 * @returns {Promise<string>} Thumbnail filename
 */
async function generateThumbnail(filename, filepath) {
  try {
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const thumbnailFilename = `${nameWithoutExt}-thumb.webp`;
    const thumbnailPath = path.join(path.dirname(filepath), thumbnailFilename);

    await sharp(filepath)
      .resize(300, 300, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toFile(thumbnailPath);

    return thumbnailFilename;
  } catch (error) {
    console.error(`Error generating thumbnail for ${filename}:`, error);
    // Return empty string if thumbnail generation fails - we'll use original
    return '';
  }
}

/**
 * Helper function: Delete all images associated with a note from the filesystem
 * @param {Object} note - Note object with images array
 * @returns {Promise<void>}
 */
async function deleteNoteImages(note) {
  if (!note.images || note.images.length === 0) {
    return; // No images to delete
  }

  // Delete all images and thumbnails from filesystem
  const deletePromises = note.images.flatMap(image => {
    const promises = [];

    // Delete original image
    promises.push(new Promise((resolve) => {
      const filepath = path.join(__dirname, '../uploads/images', image.filename);
      fs.unlink(filepath, (err) => {
        if (err) {
          console.warn(`Warning: Could not delete image file ${image.filename}:`, err.message);
        }
        resolve();
      });
    }));

    // Delete thumbnail if it exists
    if (image.thumbnailFilename) {
      promises.push(new Promise((resolve) => {
        const thumbpath = path.join(__dirname, '../uploads/images', image.thumbnailFilename);
        fs.unlink(thumbpath, (err) => {
          if (err) {
            console.warn(`Warning: Could not delete thumbnail ${image.thumbnailFilename}:`, err.message);
          }
          resolve();
        });
      }));
    }

    return promises;
  });

  await Promise.all(deletePromises);
}

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

  const note = await Note.findOne({ _id: noteId, userId: userId });
  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  const nextIsTodoList = isTodoList !== undefined ? isTodoList : note.isTodoList;
  const nextTodoItems = todoItems !== undefined ? todoItems : note.todoItems;
  const nextContent = content !== undefined
    ? (nextIsTodoList ? '' : (content?.trim() || ''))
    : (nextIsTodoList ? '' : note.content);

  if (nextIsTodoList) {
    const hasValidTodoItems = nextTodoItems &&
      nextTodoItems.length > 0 &&
      nextTodoItems.some(item => item.text && item.text.trim());

    if (!hasValidTodoItems) {
      const error = new Error('Todo-Liste muss mindestens ein Element enthalten');
      error.statusCode = 400;
      throw error;
    }
  } else if (!nextContent || nextContent.trim() === '') {
    const error = new Error('Inhalt ist erforderlich');
    error.statusCode = 400;
    throw error;
  }

  if (title !== undefined) note.title = title;
  if (color !== undefined) note.color = color;
  if (isPinned !== undefined) note.isPinned = isPinned;
  if (tags !== undefined) note.tags = tags;
  if (linkPreviews !== undefined) note.linkPreviews = linkPreviews;
  if (isTodoList !== undefined) note.isTodoList = isTodoList;

  if (content !== undefined || isTodoList !== undefined) {
    note.content = nextContent;
  }

  if (todoItems !== undefined || isTodoList !== undefined) {
    note.todoItems = nextIsTodoList ? nextTodoItems : [];
  }

  const updatedNote = await note.save();

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
  // First, find the note to get image information
  const note = await Note.findOne({
    _id: noteId,
    userId: userId
  });

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Delete all associated images from filesystem
  await deleteNoteImages(note);

  // Now delete the note from database
  await Note.findOneAndDelete({
    _id: noteId,
    userId: userId
  });

  return note;
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
  // SECURITY/DATA INTEGRITY: Verify target user exists before sharing
  // This prevents creating dangling references to deleted users
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    const error = new Error('Benutzer nicht gefunden');
    error.statusCode = 404;
    throw error;
  }

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

/**
 * Add images to a note
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {Array} imageData - Array of image objects {url, filename, uploadedAt}
 * @returns {Promise<Object>} Updated note
 */
async function addImages(noteId, userId, imageData) {
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $push: { images: { $each: imageData } }
    },
    {
      new: true,
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
 * Remove an image from a note
 * @param {string} noteId - Note ID
 * @param {string} userId - Owner user ID
 * @param {string} filename - Image filename to remove
 * @returns {Promise<Object>} Updated note
 */
async function removeImage(noteId, userId, filename) {
  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId
    },
    {
      $pull: { images: { filename: filename } }
    },
    {
      new: true,
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
  addImages,
  removeImage,
  generateThumbnail, // Export for use in routes
  deleteNoteImages, // Export for use in adminService
  buildNotesQuery, // Export for testing
};
