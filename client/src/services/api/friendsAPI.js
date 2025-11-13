import { API_ENDPOINTS } from '../../constants/api';
import { fetchWithAuth, buildQueryString } from './apiUtils';

/**
 * Friends API module
 * Handles friend relationships and friend requests
 */
const friendsAPI = {
  /**
   * Get list of all friends
   * @returns {Promise<Array>} Array of friends
   */
  getFriends: () => fetchWithAuth(API_ENDPOINTS.FRIENDS.BASE),

  /**
   * Get pending friend requests
   * @returns {Promise<Array>} Array of friend requests
   */
  getFriendRequests: () => fetchWithAuth(API_ENDPOINTS.FRIENDS.REQUESTS),

  /**
   * Send a friend request to a user
   * @param {string} username - Username to send request to
   * @returns {Promise<Object>} Friend request data
   */
  sendFriendRequest: (username) =>
    fetchWithAuth(API_ENDPOINTS.FRIENDS.REQUEST, {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  /**
   * Accept a friend request
   * @param {string} requestId - Friend request ID
   * @returns {Promise<Object>} Updated friend data
   */
  acceptFriendRequest: (requestId) =>
    fetchWithAuth(API_ENDPOINTS.FRIENDS.ACCEPT(requestId), {
      method: 'POST',
    }),

  /**
   * Reject a friend request
   * @param {string} requestId - Friend request ID
   * @returns {Promise<Object>} Confirmation
   */
  rejectFriendRequest: (requestId) =>
    fetchWithAuth(API_ENDPOINTS.FRIENDS.REJECT(requestId), {
      method: 'POST',
    }),

  /**
   * Remove a friend
   * @param {string} friendId - Friend's user ID
   * @returns {Promise<Object>} Confirmation
   */
  removeFriend: (friendId) =>
    fetchWithAuth(API_ENDPOINTS.FRIENDS.REMOVE(friendId), {
      method: 'DELETE',
    }),

  /**
   * Search for users by username
   * @param {string} query - Search query
   * @returns {Promise<Array>} Array of matching users
   */
  searchUsers: (query) => {
    const params = buildQueryString({ query });
    return fetchWithAuth(`${API_ENDPOINTS.FRIENDS.SEARCH}?${params}`);
  },
};

export default friendsAPI;
