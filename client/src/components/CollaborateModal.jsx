import React, { useState, useEffect } from 'react';
import './CollaborateModal.css';
import { notesAPI, friendsAPI } from '../services/api';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { useLanguage } from '../contexts/LanguageContext';
import { useModalA11y } from '../hooks/useModalA11y';
import { toastBus } from './ToastStack';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

function CollaborateModal({ isOpen, onClose, note, onNoteUpdate }) {
  const { t } = useLanguage();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // App behält `collaborateNote` beim Öffnen und aktualisiert es nicht nach dem
  // Teilen. Ohne diese lokale Kopie blieben Button („Teilen“ statt „✓ Geteilt“)
  // und die „Geteilt mit“-Liste veraltet — ein zweiter Klick würde die Notiz
  // dann wieder ent-teilen, obwohl die UI noch „Teilen“ zeigt.
  const [currentNote, setCurrentNote] = useState(note);

  useEffect(() => {
    setCurrentNote(note);
  }, [note]);

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
      setError(resolveApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (friendId) => {
    try {
      const updatedNote = await notesAPI.shareNote(currentNote._id, friendId);
      setCurrentNote(updatedNote);
      onNoteUpdate(updatedNote);
      setError(null);
      toastBus.success(t('noteShared'));
    } catch (err) {
      setError(resolveApiErrorMessage(err, t));
    }
  };

  const handleUnshare = async (friendId) => {
    try {
      const updatedNote = await notesAPI.unshareNote(currentNote._id, friendId);
      setCurrentNote(updatedNote);
      onNoteUpdate(updatedNote);
      setError(null);
      toastBus.success(t('noteUnshared'));
    } catch (err) {
      setError(resolveApiErrorMessage(err, t));
    }
  };

  const backdropClose = useBackdropClose(onClose);

  const { containerRef, titleId } = useModalA11y({ onClose, active: isOpen && Boolean(currentNote) });

  const sharedWithIds = currentNote?.sharedWith?.map(user => user._id || user) || [];

  return (
    <>
      {isOpen && currentNote && (
        <div className="modal-overlay" {...backdropClose}>
          <div
            className="collaborate-modal"
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="collaborate-modal-header">
              <h2 id={titleId}>{t('shareNote')}</h2>
              <button className="close-btn" onClick={onClose} aria-label={t('close')}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div className="collaborate-modal-content">
              {error && (
                <div className="error-message" role="alert">
                  {error}
                  <button onClick={() => setError(null)} aria-label={t('close')}>×</button>
                </div>
              )}

              <div className="note-preview">
                <div className="note-title">{currentNote.title || 'Untitled'}</div>
                <div className="note-snippet">
                  {currentNote.content?.substring(0, 100) || t('noDescription')}
                  {currentNote.content?.length > 100 && '...'}
                </div>
              </div>

              {loading ? (
                <div className="loading">{t('loadingFriends')}</div>
              ) : friends.length === 0 ? (
                <div className="empty-state">
                  <p>{t('noFriendsFound')}</p>
                  <p className="hint">{t('addFriendsToShareHint')}</p>
                </div>
              ) : (
                <div className="friends-list">
                  <h3>{t('shareWithFriends')}</h3>
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
                          {isShared ? `✓ ${t('shared')}` : t('share')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {currentNote.sharedWith && currentNote.sharedWith.length > 0 && (
                <div className="shared-with-section">
                  <h3>{t('sharedWith')}</h3>
                  <div className="shared-users">
                    {currentNote.sharedWith.map((user) => (
                      <div key={user._id || user} className="shared-user">
                        <span>{user.username || t('unknownUser')}</span>
                        <button
                          className="btn-remove-share"
                          onClick={() => handleUnshare(user._id || user)}
                          title={t('unshareTitle')}
                          aria-label={t('unshareTitle')}
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
      )}
    </>
  );
}

export default CollaborateModal;
