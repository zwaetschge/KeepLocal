/**
 * Friends Service
 * Business logic for friend relationships and requests
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const { errorMessages } = require('../constants');

/**
 * Get all friends for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of friends
 */
async function getFriends(userId) {
  const user = await User.findById(userId).populate('friends', 'username email');
  return user ? user.friends : [];
}

/**
 * Get pending friend requests
 * @param {string} userId - User ID
 * @returns {Promise<Array>} List of friend requests
 */
async function getFriendRequests(userId) {
  const user = await User.findById(userId).populate('friendRequests', 'username email');
  return user ? user.friendRequests : [];
}

/**
 * Send a friend request
 * @param {string} userId - Sender user ID
 * @param {string} targetUsername - Target username
 * @returns {Promise<Object>} Friend request result
 */
async function sendFriendRequest(userId, targetUsername) {
  const sender = await User.findById(userId);
  const target = await User.findOne({ username: targetUsername });

  if (!target) {
    const error = new Error(errorMessages.FRIENDS.NOT_FOUND);
    error.statusCode = 404;
    throw error;
  }

  if (userId === target._id.toString()) {
    const error = new Error(errorMessages.FRIENDS.CANNOT_ADD_SELF);
    error.statusCode = 400;
    throw error;
  }

  // Check if already friends
  if (sender.friends.includes(target._id)) {
    const error = new Error(errorMessages.FRIENDS.ALREADY_FRIENDS);
    error.statusCode = 400;
    throw error;
  }

  // Check if request already sent
  if (target.friendRequests.includes(userId)) {
    const error = new Error(errorMessages.FRIENDS.REQUEST_ALREADY_SENT);
    error.statusCode = 400;
    throw error;
  }

  // Add friend request
  target.friendRequests.push(userId);
  await target.save();

  return { message: 'Freundschaftsanfrage gesendet', user: target };
}

/**
 * Accept a friend request
 * @param {string} userId - User ID accepting the request
 * @param {string} requestId - ID of user who sent the request
 * @returns {Promise<Object>} Result
 */
async function acceptFriendRequest(userId, requestId) {
  // Start a MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction
    await session.startTransaction();

    const user = await User.findById(userId).session(session);
    const requester = await User.findById(requestId).session(session);

    if (!requester) {
      const error = new Error(errorMessages.FRIENDS.REQUEST_NOT_FOUND);
      error.statusCode = 404;
      throw error;
    }

    // Remove from friend requests
    user.friendRequests = user.friendRequests.filter(id => id.toString() !== requestId);

    // Add to friends
    if (!user.friends.includes(requestId)) {
      user.friends.push(requestId);
    }
    if (!requester.friends.includes(userId)) {
      requester.friends.push(userId);
    }

    // Save both users atomically within transaction
    await user.save({ session });
    await requester.save({ session });

    // Commit transaction
    await session.commitTransaction();

    return { message: 'Freundschaftsanfrage akzeptiert' };
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
 * Reject a friend request
 * @param {string} userId - User ID rejecting the request
 * @param {string} requestId - ID of user who sent the request
 * @returns {Promise<Object>} Result
 */
async function rejectFriendRequest(userId, requestId) {
  const user = await User.findById(userId);

  user.friendRequests = user.friendRequests.filter(id => id.toString() !== requestId);
  await user.save();

  return { message: 'Freundschaftsanfrage abgelehnt' };
}

/**
 * Remove a friend
 * @param {string} userId - User ID
 * @param {string} friendId - Friend ID to remove
 * @returns {Promise<Object>} Result
 */
async function removeFriend(userId, friendId) {
  // Start a MongoDB session for transaction
  const session = await mongoose.startSession();

  try {
    // Start transaction
    await session.startTransaction();

    const user = await User.findById(userId).session(session);
    const friend = await User.findById(friendId).session(session);

    if (!friend) {
      const error = new Error(errorMessages.FRIENDS.NOT_FOUND);
      error.statusCode = 404;
      throw error;
    }

    // Remove from both users
    user.friends = user.friends.filter(id => id.toString() !== friendId);
    friend.friends = friend.friends.filter(id => id.toString() !== userId);

    // Save both users atomically within transaction
    await user.save({ session });
    await friend.save({ session });

    // Commit transaction
    await session.commitTransaction();

    return { message: 'Freund entfernt' };
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
 * Search for users by username
 * @param {string} query - Search query
 * @param {string} userId - Current user ID (to exclude from results)
 * @returns {Promise<Array>} Matching users
 */
async function searchUsers(query, userId) {
  const users = await User.find({
    username: { $regex: query, $options: 'i' },
    _id: { $ne: userId }
  }).select('username email').limit(10);

  return users;
}

module.exports = {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  searchUsers,
};
