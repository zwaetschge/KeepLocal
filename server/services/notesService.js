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

const NOTE_COLORS = new Set([
  '#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90', '#a7ffeb',
  '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'
]);
const TAG_PATTERN = /^[a-zA-Z0-9äöüÄÖÜß\-_]+$/;
const MAX_IMAGE_PIXELS = 40000000;
const MAX_IMAGES_PER_NOTE = 25;

function clientError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizePositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function validateNoteContent({ isTodoList, todoItems, content }) {
  if (isTodoList) {
    const hasValidTodoItems = Array.isArray(todoItems) &&
      todoItems.some(item => typeof item?.text === 'string' && item.text.trim());
    if (!hasValidTodoItems) {
      throw clientError('Todo-Liste muss mindestens ein Element enthalten');
    }
    return;
  }

  if (typeof content !== 'string' || !content.trim()) {
    throw clientError('Inhalt ist erforderlich');
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function validateNoteFields(noteData) {
  if (!noteData || typeof noteData !== 'object' || Array.isArray(noteData)) {
    throw clientError('Ungueltige Notizdaten');
  }

  if (noteData.title !== undefined && (typeof noteData.title !== 'string' || noteData.title.length > 200)) {
    throw clientError('Titel darf maximal 200 Zeichen lang sein');
  }
  if (noteData.content !== undefined && (typeof noteData.content !== 'string' || noteData.content.length > 10000)) {
    throw clientError('Inhalt darf maximal 10.000 Zeichen lang sein');
  }
  if (noteData.color !== undefined && !NOTE_COLORS.has(noteData.color)) {
    throw clientError('Ungueltige Notizfarbe');
  }
  for (const field of ['isPinned', 'isTodoList']) {
    if (noteData[field] !== undefined && typeof noteData[field] !== 'boolean') {
      throw clientError(`${field} muss ein Boolean sein`);
    }
  }

  if (noteData.tags !== undefined) {
    if (!Array.isArray(noteData.tags) || noteData.tags.length > 50) {
      throw clientError('Maximal 50 Tags sind erlaubt');
    }
    if (noteData.tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 50 || !TAG_PATTERN.test(tag))) {
      throw clientError('Ungueltiger Tag');
    }
  }

  if (noteData.todoItems !== undefined) {
    if (!Array.isArray(noteData.todoItems) || noteData.todoItems.length > 200) {
      throw clientError('Maximal 200 Todo-Eintraege sind erlaubt');
    }
    const invalidItem = noteData.todoItems.some(item => (
      !item ||
      typeof item !== 'object' ||
      typeof item.text !== 'string' ||
      item.text.length > 500 ||
      (item.completed !== undefined && typeof item.completed !== 'boolean') ||
      (item.order !== undefined && !Number.isInteger(item.order))
    ));
    if (invalidItem) throw clientError('Ungueltiger Todo-Eintrag');
  }

  if (noteData.linkPreviews !== undefined) {
    if (!Array.isArray(noteData.linkPreviews) || noteData.linkPreviews.length > 20) {
      throw clientError('Maximal 20 Link-Vorschauen sind erlaubt');
    }
    const invalidPreview = noteData.linkPreviews.some(preview => (
      !preview ||
      typeof preview !== 'object' ||
      typeof preview.url !== 'string' ||
      !isHttpUrl(preview.url) ||
      (preview.title !== undefined && (typeof preview.title !== 'string' || preview.title.length > 200)) ||
      (preview.description !== undefined && (typeof preview.description !== 'string' || preview.description.length > 500)) ||
      (preview.image && (typeof preview.image !== 'string' || !isHttpUrl(preview.image))) ||
      (preview.siteName !== undefined && (typeof preview.siteName !== 'string' || preview.siteName.length > 100))
    ));
    if (invalidPreview) throw clientError('Ungueltige Link-Vorschau');
  }
}

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

    await sharp(filepath, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' })
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

async function validateImageDimensions(filepaths) {
  try {
    for (const filepath of filepaths) {
      const metadata = await sharp(filepath, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: 'error'
      }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
        throw new Error('image dimensions exceed limit');
      }
    }
  } catch (_) {
    throw clientError('Bildaufloesung ist ungueltig oder zu gross');
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

  // Filter by tag (case-insensitive to match tags regardless of stored casing)
  if (tag && tag.trim() !== '') {
    query.tags = { $regex: new RegExp(`^${tag.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
  }

  return query;
}

/**
 * Get all notes with optional filtering and pagination
 * @param {Object} params - Query parameters
 * @returns {Promise<Object>} Notes and pagination info
 */
async function getAllNotes({ userId, search, tag, page = 1, limit = 50, archived = 'false' }) {
  const safePage = normalizePositiveInteger(page, 1, Number.MAX_SAFE_INTEGER);
  const safeLimit = normalizePositiveInteger(limit, 50, 100);
  const isArchived = archived === true || archived === 'true';
  const query = buildNotesQuery({ userId, search, tag, isArchived });
  const activeQuery = buildNotesQuery({ userId, isArchived: false });
  const archivedQuery = buildNotesQuery({ userId, isArchived: true });

  const skip = (safePage - 1) * safeLimit;
  const [total, activeCount, archivedCount, tags] = await Promise.all([
    Note.countDocuments(query),
    Note.countDocuments(activeQuery),
    Note.countDocuments(archivedQuery),
    Note.aggregate([
      { $match: isArchived ? archivedQuery : activeQuery },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, name: '$_id', count: 1 } }
    ])
  ]);

  const notes = await Note.find(query)
    .populate('userId', 'username email')
    .populate('sharedWith', 'username email')
    .sort({ isPinned: -1, createdAt: -1 }) // Pinned notes first
    .skip(skip)
    .limit(safeLimit);

  return {
    notes,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit)
    },
    counts: { active: activeCount, archived: archivedCount },
    tags
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

async function getOwnedNoteById(noteId, userId) {
  const note = await Note.findOne({ _id: noteId, userId });
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
  validateNoteFields(noteData);
  const { title, content, color, isPinned, tags, isTodoList, todoItems, linkPreviews } = noteData;
  const normalizedIsTodoList = isTodoList === true;
  const normalizedContent = normalizedIsTodoList ? '' : (typeof content === 'string' ? content.trim() : '');
  const normalizedTodoItems = normalizedIsTodoList && Array.isArray(todoItems) ? todoItems : [];

  validateNoteContent({
    isTodoList: normalizedIsTodoList,
    todoItems: normalizedTodoItems,
    content: normalizedContent
  });

  const newNote = new Note({
    title: title || '',
    content: normalizedContent,
    color: color || '#ffffff',
    isPinned: isPinned || false,
    tags: tags || [],
    isTodoList: normalizedIsTodoList,
    todoItems: normalizedTodoItems,
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
  validateNoteFields(noteData);
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

  validateNoteContent({
    isTodoList: nextIsTodoList,
    todoItems: nextTodoItems,
    content: nextContent
  });

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
  // Delete the database record first. If MongoDB fails, the note must retain
  // all of its image files rather than becoming silently corrupted.
  const note = await Note.findOneAndDelete({
    _id: noteId,
    userId: userId
  });

  if (!note) {
    const error = new Error(errorMessages.NOTES.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  await deleteNoteImages(note);

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
  if (!Array.isArray(imageData) || imageData.length < 1 || imageData.length > 5) {
    throw clientError('Pro Upload sind 1 bis 5 Bilder erlaubt');
  }

  const note = await Note.findOneAndUpdate(
    {
      _id: noteId,
      userId: userId,
      $expr: {
        $lte: [
          { $size: { $ifNull: ['$images', []] } },
          MAX_IMAGES_PER_NOTE - imageData.length
        ]
      }
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
    const ownedNoteExists = await Note.exists({ _id: noteId, userId });
    if (ownedNoteExists) {
      throw clientError(`Maximal ${MAX_IMAGES_PER_NOTE} Bilder pro Notiz erlaubt`);
    }
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
      userId: userId,
      'images.filename': filename
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
  getOwnedNoteById,
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
  validateImageDimensions,
  deleteNoteImages, // Export for use in adminService
  buildNotesQuery, // Export for testing
  normalizePositiveInteger,
  validateNoteContent,
  validateNoteFields,
};
