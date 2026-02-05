import React, { useState, useEffect } from 'react';
import './FriendsModal.css';
import { friendsAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

function FriendsModal({ isOpen, onClose, isAdmin }) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('friends'); // 'friends', 'requests', 'add'
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadFriends();
      loadFriendRequests();
    }
  }, [isOpen]);

  const loadFriends = async () => {
    try {
      setLoading(true);
      const data = await friendsAPI.getFriends();
      setFriends(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFriendRequests = async () => {
    try {
      const data = await friendsAPI.getFriendRequests();
      setFriendRequests(data);
    } catch (err) {
      console.error('Error loading friend requests:', err);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setLoading(true);
      const results = await friendsAPI.searchUsers(searchQuery);
      setSearchResults(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendRequest = async (username) => {
    try {
      await friendsAPI.sendFriendRequest(username);
      setError(null);
      alert('Freundschaftsanfrage gesendet!');
      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAcceptRequest = async (requestId) => {
    try {
      await friendsAPI.acceptFriendRequest(requestId);
      loadFriendRequests();
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRejectRequest = async (requestId) => {
    try {
      await friendsAPI.rejectFriendRequest(requestId);
      loadFriendRequests();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveFriend = async (friendId) => {
    if (!window.confirm('Möchtest du diesen Freund wirklich entfernen?')) {
      return;
    }

    try {
      await friendsAPI.removeFriend(friendId);
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="friends-modal" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2>{t('friends')}</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="friends-modal-tabs">
          <button
            className={`tab-btn ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setActiveTab('friends')}
          >
            {t('friendsList')} ({friends.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            {t('requests')} ({friendRequests.length})
          </button>
          <button
            className={`tab-btn ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
          >
            {isAdmin ? t('searchUsers') : t('addFriendTab')}
          </button>
        </div>

        <div className="friends-modal-content">
          {error && (
            <div className="error-message">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {activeTab === 'friends' && (
            <div className="friends-list">
              {loading ? (
                <div className="loading">{t('loading')}</div>
              ) : friends.length === 0 ? (
                <div className="empty-state">
                  <p>{t('noFriends')}</p>
                  <p className="hint">{t('addFriend')}</p>
                </div>
              ) : (
                friends.map((friend) => (
                  <div key={friend._id} className="friend-item">
                    <div className="friend-info">
                      <div className="friend-name">{friend.username}</div>
                      <div className="friend-email">{friend.email}</div>
                    </div>
                    <button
                      className="btn-remove"
                      onClick={() => handleRemoveFriend(friend._id)}
                      title={t('removeFriend')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="requests-list">
              {friendRequests.length === 0 ? (
                <div className="empty-state">
                  <p>{t('noFriendRequests')}</p>
                </div>
              ) : (
                friendRequests.map((request) => (
                  <div key={request._id} className="request-item">
                    <div className="request-info">
                      <div className="request-name">{request.from.username}</div>
                      <div className="request-email">{request.from.email}</div>
                    </div>
                    <div className="request-actions">
                      <button
                        className="btn-accept"
                        onClick={() => handleAcceptRequest(request._id)}
                      >
                        ✓ {t('accept')}
                      </button>
                      <button
                        className="btn-reject"
                        onClick={() => handleRejectRequest(request._id)}
                      >
                        × {t('reject')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'add' && (
            <div className="add-friend">
              <div className="search-box">
                <input
                  type="text"
                  placeholder={t('searchUsers')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button onClick={handleSearch} disabled={loading}>
                  {loading ? t('loading') : t('search')}
                </button>
              </div>

              <div className="search-results">
                {searchResults.length === 0 && searchQuery && !loading && (
                  <div className="empty-state">
                    <p>{t('noFriends')}</p>
                  </div>
                )}

                {searchResults.map((user) => (
                  <div key={user._id} className="search-result-item">
                    <div className="user-info">
                      <div className="user-name">{user.username}</div>
                      <div className="user-email">{user.email}</div>
                    </div>
                    <button
                      className="btn-add"
                      onClick={() => handleSendRequest(user.username)}
                      disabled={friends.some(f => f._id === user._id)}
                    >
                      {friends.some(f => f._id === user._id) ? `✓ ${t('friends')}` : `+ ${t('sendFriendRequest')}`}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FriendsModal;
