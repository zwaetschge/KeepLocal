import React, { useState, useEffect } from 'react';
import './FriendsModal.css';
import { friendsAPI } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { useModalA11y } from '../hooks/useModalA11y';
import { toastBus } from './ToastStack';
import ConfirmDialog from './ConfirmDialog';

function FriendsModal({ isOpen, onClose, isAdmin }) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState('friends'); // 'friends', 'requests', 'add'
  const [friends, setFriends] = useState([]);
  const [friendRequests, setFriendRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // Separate loading flags: friends list, requests list and user search are
  // independent requests — one shared flag made a finishing list request hide
  // the still-running search spinner (and vice versa).
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [removeConfirm, setRemoveConfirm] = useState(null); // friend to remove

  useEffect(() => {
    if (isOpen) {
      loadFriends();
      loadFriendRequests();
    }
  }, [isOpen]);

  const loadFriends = async () => {
    try {
      setLoadingFriends(true);
      const data = await friendsAPI.getFriends();
      setFriends(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingFriends(false);
    }
  };

  const loadFriendRequests = async () => {
    try {
      setLoadingRequests(true);
      const data = await friendsAPI.getFriendRequests();
      setFriendRequests(data);
    } catch (err) {
      console.error('Error loading friend requests:', err);
    } finally {
      setLoadingRequests(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setSearching(true);
      const results = await friendsAPI.searchUsers(searchQuery);
      setSearchResults(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const handleSendRequest = async (username) => {
    try {
      await friendsAPI.sendFriendRequest(username);
      setError(null);
      toastBus.success(t('friendRequestSent'));
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
    try {
      await friendsAPI.removeFriend(friendId);
      setRemoveConfirm(null);
      loadFriends();
    } catch (err) {
      setError(err.message);
    }
  };

  const backdropClose = useBackdropClose(onClose);

  // Focus trap / initial focus / focus restore. Escape must not close the
  // whole modal while the remove-friend confirmation is open.
  const { containerRef, titleId } = useModalA11y({
    onClose,
    active: isOpen,
    closeOnEscape: isOpen && !removeConfirm,
  });

  return (
    <>
      {isOpen && (
        <div className="modal-overlay" {...backdropClose}>
          <div
            className="friends-modal"
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="friends-modal-header">
              <h2 id={titleId}>{t('friends')}</h2>
              <button className="close-btn" onClick={onClose} aria-label={t('close')}>
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
                <div className="error-message" role="alert">
                  {error}
                  <button onClick={() => setError(null)} aria-label={t('close')}>×</button>
                </div>
              )}

              {activeTab === 'friends' && (
                <div className="friends-list">
                  {loadingFriends ? (
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
                          onClick={() => setRemoveConfirm(friend)}
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
                  {loadingRequests ? (
                    <div className="loading">{t('loading')}</div>
                  ) : friendRequests.length === 0 ? (
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
                    <button onClick={handleSearch} disabled={searching}>
                      {searching ? t('loading') : t('search')}
                    </button>
                  </div>

                  <div className="search-results">
                    {searchResults.length === 0 && searchQuery && !searching && (
                      <div className="empty-state">
                        <p>{t('noFriends')}</p>
                      </div>
                    )}

                    {searchResults.map((user) => (
                      <div key={user._id} className="search-result-item">
                        <div className="user-info">
                          <div className="user-name">{user.username}</div>
                          {user.email && <div className="user-email">{user.email}</div>}
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
      )}

      <ConfirmDialog
        isOpen={Boolean(removeConfirm)}
        title={t('confirmRemoveFriendTitle')}
        message={t('confirmRemoveFriendMessage')}
        confirmLabel={t('remove')}
        onConfirm={() => handleRemoveFriend(removeConfirm?._id)}
        onCancel={() => setRemoveConfirm(null)}
      />
    </>
  );
}

export default FriendsModal;
