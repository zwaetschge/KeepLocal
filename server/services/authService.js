/**
 * Authentication Service
 * Business logic for user authentication and registration
 */

const User = require('../models/User');
const Settings = require('../models/Settings');
const { errorMessages } = require('../constants');

/**
 * Check if initial setup is needed (no users exist)
 * @returns {Promise<Object>} Setup status
 */
async function checkSetupNeeded() {
  const userCount = await User.countDocuments();
  return {
    setupNeeded: userCount === 0,
    message: userCount === 0 ? errorMessages.AUTH.INITIAL_SETUP_REQUIRED : errorMessages.AUTH.SYSTEM_ALREADY_CONFIGURED
  };
}

/**
 * Check if registration is enabled
 * @returns {Promise<Object>} Registration status
 */
async function checkRegistrationStatus() {
  const userCount = await User.countDocuments();

  // If no users exist, registration is always allowed (first admin)
  if (userCount === 0) {
    return { registrationEnabled: true };
  }

  // Otherwise, check settings
  let settings = await Settings.findById('1');
  if (!settings) {
    settings = new Settings({ _id: '1', registrationEnabled: false });
    await settings.save();
  }

  return { registrationEnabled: settings.registrationEnabled };
}

/**
 * Register a new user
 * @param {Object} userData - User registration data
 * @returns {Promise<Object>} Created user (without password)
 */
async function registerUser(userData) {
  const { username, email, password } = userData;

  // Check if this is the first user (admin)
  const userCount = await User.countDocuments();
  const isFirstUser = userCount === 0;

  // If not first user, check if registration is enabled
  if (!isFirstUser) {
    let settings = await Settings.findById('1');
    if (!settings) {
      settings = new Settings({ _id: '1', registrationEnabled: false });
      await settings.save();
    }

    if (!settings.registrationEnabled) {
      const error = new Error(errorMessages.AUTH.REGISTRATION_DISABLED);
      error.statusCode = 403;
      throw error;
    }
  }

  // Check if user already exists
  const existingUserByEmail = await User.findOne({ email });
  if (existingUserByEmail) {
    const error = new Error(errorMessages.AUTH.EMAIL_ALREADY_EXISTS);
    error.statusCode = 409;
    throw error;
  }

  const existingUserByUsername = await User.findOne({ username });
  if (existingUserByUsername) {
    const error = new Error(errorMessages.AUTH.USERNAME_ALREADY_EXISTS);
    error.statusCode = 409;
    throw error;
  }

  // Create new user (first user is always admin)
  const user = new User({
    username,
    email,
    password, // Will be hashed by model pre-save hook
    isAdmin: isFirstUser
  });

  await user.save();

  // Return user without password
  const userObject = user.toObject();
  delete userObject.password;

  return userObject;
}

/**
 * Authenticate user login
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<Object>} User object (without password)
 * @throws {Error} If credentials are invalid
 */
async function loginUser(email, password) {
  const user = await User.findOne({ email });

  if (!user) {
    const error = new Error(errorMessages.AUTH.INVALID_CREDENTIALS);
    error.statusCode = 401;
    throw error;
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    const error = new Error(errorMessages.AUTH.INVALID_CREDENTIALS);
    error.statusCode = 401;
    throw error;
  }

  // Return user without password
  const userObject = user.toObject();
  delete userObject.password;

  return userObject;
}

/**
 * Get current user by ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User object (without password)
 */
async function getCurrentUser(userId) {
  const user = await User.findById(userId).select('-password');

  if (!user) {
    const error = new Error(errorMessages.AUTH.USER_NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  return user;
}

module.exports = {
  checkSetupNeeded,
  checkRegistrationStatus,
  registerUser,
  loginUser,
  getCurrentUser,
};
