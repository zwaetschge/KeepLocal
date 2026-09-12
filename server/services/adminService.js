/**
 * Admin Service
 * Business logic for admin operations
 */

const User = require('../models/User');
const Note = require('../models/Note');
const ApiKey = require('../models/ApiKey');
const Settings = require('../models/Settings');
const { errorMessages } = require('../constants');
const { deleteNoteImages } = require('./notesService');
const { escapeRegex } = require('../utils/sanitize');

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

  // Check if user already exists. Usernames are stored case-sensitively but
  // searched case-insensitively, so a duplicate in different casing has to be
  // rejected here as well ("ALICE" next to "alice").
  const existingUser = await User.findOne({
    $or: [
      { email },
      { username },
      { username: { $regex: new RegExp(`^${escapeRegex(username)}$`, 'i') } }
    ]
  });
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

function lastAdminError() {
  const error = new Error(errorMessages.ADMIN.LAST_ADMIN);
  error.statusCode = 409;
  error.code = 'LAST_ADMIN';
  return error;
}

/**
 * Guard against locking the instance out of its own administration.
 *
 * Password recovery only works through an admin-issued one-time token
 * (routes/auth.js `reset-password`, tokens created in routes/admin.js behind
 * `requireAdmin`) and there is no SMTP path, so an instance without an admin is
 * unrecoverable from the UI: no admin → no reset token → no password → no admin.
 *
 * Counting first is not enough: two admins revoking each other concurrently both
 * see "one admin remains" and both write, which leaves zero admins (verified
 * against a real MongoDB). Standalone MongoDB has no transactions, so the
 * demotion is executed and then verified — whoever observes an empty admin set
 * rolls their own demotion back and answers 409. Every interleaving ends with at
 * least one admin.
 *
 * @param {string} userId - the user whose admin rights are about to disappear
 */
async function assertNotLastAdmin(userId) {
  const remainingAdmins = await User.countDocuments({
    isAdmin: true,
    _id: { $ne: userId }
  });
  if (!remainingAdmins) {
    throw lastAdminError();
  }
  return remainingAdmins;
}

/**
 * Delete a user
 * @param {string} userId - User ID to delete
 * @param {string} currentUserId - Current user ID (cannot delete self)
 * @returns {Promise<Object>} Deleted user
 */
async function deleteUser(userId, currentUserId) {
  if (userId.toString() === currentUserId.toString()) {
    const error = new Error(errorMessages.ADMIN.CANNOT_DELETE_SELF);
    error.statusCode = 400;
    throw error;
  }

  const user = await User.findById(userId);
  if (!user) {
    const error = new Error(errorMessages.ADMIN.USER_NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  // Deleting the last admin would leave the instance unmanageable.
  if (user.isAdmin) {
    await assertNotLastAdmin(userId);
  }

  const userNotes = await Note.find({ userId });

  // The bundled MongoDB runs as a standalone server, where multi-document
  // transactions are unavailable. Keep files until all database work succeeds;
  // a failure can leave references to clean up, but never notes with lost files.
  await User.updateMany(
    {
      $or: [
        { friends: userId },
        { 'friendRequests.from': userId }
      ]
    },
    {
      $pull: {
        friends: userId,
        friendRequests: { from: userId }
      }
    }
  );
  await Note.updateMany(
    { sharedWith: userId },
    { $pull: { sharedWith: userId } }
  );
  await ApiKey.deleteMany({ userId });
  await Note.deleteMany({ userId });
  await User.findByIdAndDelete(userId);

  await Promise.all(userNotes.map(note => deleteNoteImages(note)));
  return user;
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

  const revoking = Boolean(user.isAdmin);
  if (revoking) {
    // Fast path: a clear 409 without touching the document.
    await assertNotLastAdmin(userId);
  }

  user.isAdmin = !user.isAdmin;
  await user.save();

  if (revoking) {
    // Act-then-verify: covers the concurrent-demotion race the pre-check cannot
    // see. If this demotion emptied the admin set, undo it and fail.
    const remaining = await User.countDocuments({ isAdmin: true });
    if (!remaining) {
      user.isAdmin = true;
      await user.save();
      throw lastAdminError();
    }
    // Frees the unique partial index `single_bootstrap_admin`: it is only ever
    // set for the first account, and a revoked user keeping it would block any
    // future bootstrap admin. Cleared only after the demotion is final.
    if (user.isBootstrapAdmin) {
      user.isBootstrapAdmin = false;
      await user.save();
    }
  }

  const userObject = user.toObject();
  delete userObject.password;
  return userObject;
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
  getSettings,
  updateSettings,
  assertNotLastAdmin,
};
