import React, { useState, useEffect } from 'react';
import './CollaborateModal.css';
import { notesAPI, friendsAPI } from '../services/api';

function CollaborateModal({ isOpen, onClose, note, onNoteUpdate }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      loadFriends();
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

  const handleShare = async (friendId) => {
    try {
      const updatedNote = await notesAPI.shareNote(note._id, friendId);
      onNoteUpdate(updatedNote);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnshare = async (friendId) => {
    try {
      const updatedNote = await notesAPI.unshareNote(note._id, friendId);
      onNoteUpdate(updatedNote);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!isOpen || !note) return null;

  const sharedWithIds = note.sharedWith?.map(user => user._id || user) || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="collaborate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="collaborate-modal-header">
          <h2>Notiz teilen</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="collaborate-modal-content">
          {error && (
            <div className="error-message">
              {error}
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          <div className="note-preview">
            <div className="note-title">{note.title || 'Untitled'}</div>
            <div className="note-snippet">
              {note.content?.substring(0, 100) || 'Keine Beschreibung'}
              {note.content?.length > 100 && '...'}
            </div>
          </div>

          {loading ? (
            <div className="loading">Lade Freunde...</div>
          ) : friends.length === 0 ? (
            <div className="empty-state">
              <p>Keine Freunde gefunden</p>
              <p className="hint">Füge zuerst Freunde hinzu, um Notizen zu teilen</p>
            </div>
          ) : (
            <div className="friends-list">
              <h3>Mit Freunden teilen:</h3>
              {friends.map((friend) => {
                const isShared = sharedWithIds.includes(friend._id);

                return (
                  <div key={friend._id} className="friend-item">
                    <div className="friend-info">
                      <div className="friend-name">{friend.username}</div>
                      <div className="friend-email">{friend.email}</div>
                    </div>
                    <button
                      className={`btn-share ${isShared ? 'shared' : ''}`}
                      onClick={() => isShared ? handleUnshare(friend._id) : handleShare(friend._id)}
                    >
                      {isShared ? '✓ Geteilt' : 'Teilen'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {note.sharedWith && note.sharedWith.length > 0 && (
            <div className="shared-with-section">
              <h3>Geteilt mit:</h3>
              <div className="shared-users">
                {note.sharedWith.map((user) => (
                  <div key={user._id || user} className="shared-user">
                    <span>{user.username || 'Unbekannt'}</span>
                    <button
                      className="btn-remove-share"
                      onClick={() => handleUnshare(user._id || user)}
                      title="Teilung aufheben"
                    >
                      ×
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

export default CollaborateModal;
