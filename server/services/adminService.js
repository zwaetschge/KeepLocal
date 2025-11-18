/**
 * Admin Service
 * Business logic for admin operations
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Note = require('../models/Note');
const Settings = require('../models/Settings');
const { errorMessages } = require('../constants');
const { deleteNoteImages } = require('./notesService');

/**
 * Get all users
 * @returns {Promise<Array>} List of users (without passwords)
 */
async function getAllUsers() {
  const users = await User.find()
    .select('-password')
    .sort({ createdAt: -1 });

  return users;
}

/**
 * Create a new user (admin only)
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user
 */
async function createUser(userData) {
  const { username, email, password, isAdmin } = userData;

  // Check if user already exists
  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) {
    const error = new Error(
      existingUser.email === email
        ? errorMessages.AUTH.EMAIL_ALREADY_EXISTS
        : errorMessages.AUTH.USERNAME_ALREADY_EXISTS
    );
    error.statusCode = 409;
    throw error;
  }

  const user = new User({
    username,
    email,
    password, // Will be hashed by model pre-save hook
    isAdmin: isAdmin || false
  });

  await user.save();

  const userObject = user.toObject();
  delete userObject.password;
  return userObject;
}

/**
 * Delete a user
 * @param {string} userId - User ID to delete
 * @param {string} currentUserId - Current user ID (cannot delete self)
 * @returns {Promise<Object>} Deleted user
 */
async function deleteUser(userId, currentUserId) {
  if (userId === currentUserId) {
    const error = new Error(errorMessages.ADMIN.CANNOT_DELETE_SELF);
    error.statusCode = 400;
    throw error;
  }

  // First, get all notes owned by this user to delete their images
  // This must be done before starting the transaction since filesystem operations
  // are not part of the transaction
  const userNotes = await Note.find({ userId });

  // Delete all images from filesystem for each note
  // This happens outside the transaction as it's a filesystem operation
  await Promise.all(userNotes.map(note => deleteNoteImages(note)));

  // Start a MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction - ensures atomic deletion of user and all references
    await session.startTransaction();

    const user = await User.findById(userId).session(session);
    if (!user) {
      const error = new Error(errorMessages.ADMIN.USER_NOT_FOUND);
      error.statusCode = 404;
      throw error;
    }

    // Clean up all references to this user to prevent dangling references
    // All operations happen atomically within the transaction
    await Promise.all([
      // Remove user from all friends lists
      User.updateMany(
        { friends: userId },
        { $pull: { friends: userId } },
        { session }
      ),
      // Remove user from all friend request lists
      User.updateMany(
        { friendRequests: userId },
        { $pull: { friendRequests: userId } },
        { session }
      ),
      // Remove user from all sharedWith arrays in notes
      Note.updateMany(
        { sharedWith: userId },
        { $pull: { sharedWith: userId } },
        { session }
      ),
      // Delete all notes owned by this user (after images are deleted)
      Note.deleteMany({ userId }, { session })
    ]);

    // Finally delete the user
    await User.findByIdAndDelete(userId, { session });

    // Commit transaction
    await session.commitTransaction();

    return user;
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();
    throw error;
  } finally {
    // End session
    session.endSession();
  }
}

/**
 * Toggle admin status of a user
 * @param {string} userId - User ID
 * @param {string} currentUserId - Current user ID (cannot modify self)
 * @returns {Promise<Object>} Updated user
 */
async function toggleUserAdmin(userId, currentUserId) {
  if (userId === currentUserId) {
    const error = new Error(errorMessages.ADMIN.CANNOT_MODIFY_SELF);
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId);
  if (!user) {
    const error = new Error(errorMessages.ADMIN.USER_NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  user.isAdmin = !user.isAdmin;
  await user.save();

  const userObject = user.toObject();
  delete userObject.password;
  return userObject;
}

/**
 * Get system statistics
 * @returns {Promise<Object>} System stats
 */
async function getStats() {
  const [userCount, noteCount, archivedCount] = await Promise.all([
    User.countDocuments(),
    Note.countDocuments({ isArchived: false }),
    Note.countDocuments({ isArchived: true })
  ]);

  return {
    users: userCount,
    notes: noteCount,
    archivedNotes: archivedCount,
    totalNotes: noteCount + archivedCount
  };
}

/**
 * Get system settings
 * @returns {Promise<Object>} Settings
 */
async function getSettings() {
  let settings = await Settings.findById('1');
  if (!settings) {
    settings = new Settings({ _id: '1', registrationEnabled: false });
    await settings.save();
  }
  return settings;
}

/**
 * Update system settings
 * @param {Object} settingsData - Settings to update
 * @returns {Promise<Object>} Updated settings
 */
async function updateSettings(settingsData) {
  let settings = await Settings.findById('1');
  if (!settings) {
    settings = new Settings({ _id: '1', ...settingsData });
  } else {
    Object.assign(settings, settingsData);
  }
  await settings.save();
  return settings;
}

module.exports = {
  getAllUsers,
  createUser,
  deleteUser,
  toggleUserAdmin,
  getStats,
  getSettings,
  updateSettings,
};
