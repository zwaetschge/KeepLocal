import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './AdminConsole.css';
import { adminAPI } from '../services/api';
import ConfirmDialog from './ConfirmDialog';
import { copyToClipboard } from '../utils/clipboard.mjs';
import { toastBus } from './ToastStack';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { useModalA11y } from '../hooks/useModalA11y';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

/** Bytes lesbar (v1.13.0 Nr. 3): Recovery-Points- und Speicher-Anzeige. */
function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function AdminConsole({ onClose }) {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(null);
  // v1.13.0 Nr. 3: Backup-Scheduler — Status + Recovery Points
  const [backups, setBackups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stats');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [operationLoading, setOperationLoading] = useState({});
  const [error, setError] = useState(null);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', email: '', password: '', isAdmin: false });
  // Einmal-Passwort-Reset-Token (Self-Hosting ohne Mail-Versand): wird nur hier
  // angezeigt und von den Admins an die Person übergeben.
  const [resetTokenInfo, setResetTokenInfo] = useState(null);
  const [resetTokenCopied, setResetTokenCopied] = useState(false);
  const locale = language === 'de' ? 'de-DE' : 'en-GB';

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (activeTab === 'stats') {
        const data = await adminAPI.getStats();
        setStats(data.stats);
      } else if (activeTab === 'users') {
        const data = await adminAPI.getUsers();
        setUsers(data.users);
      } else if (activeTab === 'settings') {
        const data = await adminAPI.getSettings();
        setSettings(data.settings);
      } else if (activeTab === 'backups') {
        // Backups + Speicherplatz (stats) zusammen — die Storage-Anzeige im
        // Backup-Tab kommt aus demselben Stats-Endpoint, Best-Effort.
        const [backupData, statsData] = await Promise.all([
          adminAPI.getBackups(),
          adminAPI.getStats().catch(() => null)
        ]);
        setBackups(backupData);
        if (statsData?.stats) setStats(statsData.stats);
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
      setError(resolveApiErrorMessage(error, t, 'errorLoadingData'));
    } finally {
      setLoading(false);
    }
  }, [activeTab, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDeleteUser = async (userId) => {
    setOperationLoading(prev => ({ ...prev, [userId]: 'delete' }));
    try {
      await adminAPI.deleteUser(userId);
      setUsers(prev => prev.filter(u => u._id !== userId));
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      setError(resolveApiErrorMessage(error, t, 'errorDeletingUser'));
    } finally {
      setOperationLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleToggleAdmin = async (userId) => {
    setOperationLoading(prev => ({ ...prev, [userId]: 'admin' }));
    try {
      const response = await adminAPI.toggleUserAdmin(userId);
      setUsers(prev => prev.map(u =>
        u._id === userId ? { ...u, isAdmin: response.user.isAdmin } : u
      ));
    } catch (error) {
      console.error('Error toggling admin status:', error);
      setError(resolveApiErrorMessage(error, t, 'errorTogglingAdmin'));
    } finally {
      setOperationLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();

    if (!newUser.username || !newUser.email || !newUser.password) {
      setError(t('fillAllFields'));
      return;
    }

    setOperationLoading(prev => ({ ...prev, create: true }));
    try {
      const response = await adminAPI.createUser(newUser);
      // The API answers with { id }, but every row action keys on _id — map it
      // so the new row's admin-toggle/delete buttons work without a refetch.
      setUsers(prev => [...prev, { ...response.user, _id: response.user.id }]);
      setNewUser({ username: '', email: '', password: '', isAdmin: false });
      setShowCreateUser(false);
      setError(null);
    } catch (error) {
      console.error('Error creating user:', error);
      setError(resolveApiErrorMessage(error, t, 'errorCreatingUser'));
    } finally {
      setOperationLoading(prev => ({ ...prev, create: false }));
    }
  };

  const handleCreatePasswordReset = async (user) => {
    setOperationLoading(prev => ({ ...prev, [user._id]: 'reset' }));
    try {
      const response = await adminAPI.createPasswordReset(user._id);
      setResetTokenInfo({
        token: response.resetToken,
        username: response.user?.username || user.username,
        expiresAt: response.expiresAt,
      });
      setResetTokenCopied(false);
      setError(null);
      toastBus.success(t('resetTokenCreatedTitle'));
    } catch (err) {
      console.error('Error creating password reset token:', err);
      setError(resolveApiErrorMessage(err, t, 'resetTokenFailed'));
    } finally {
      setOperationLoading(prev => ({ ...prev, [user._id]: false }));
    }
  };

  const handleCopyResetToken = async () => {
    if (!resetTokenInfo?.token) return;
    const copied = await copyToClipboard(resetTokenInfo.token);
    setResetTokenCopied(Boolean(copied));
    if (!copied) {
      toastBus.error(t('copyToClipboardFailed'));
    }
  };

  const handleToggleRegistration = async () => {
    setOperationLoading(prev => ({ ...prev, settings: true }));
    try {
      const response = await adminAPI.updateSettings({
        registrationEnabled: !settings.registrationEnabled
      });
      setSettings(response.settings);
      setError(null);
    } catch (error) {
      console.error('Error updating settings:', error);
      setError(resolveApiErrorMessage(error, t, 'errorUpdatingSettings'));
    } finally {
      setOperationLoading(prev => ({ ...prev, settings: false }));
    }
  };

  // v1.13.0 Nr. 3: Backup manuell anstoßen. Der Endpoint wartet auf den Lauf;
  // danach Status + Punkte neu lesen, damit Ziel und Dauer sofort stimmen.
  const handleRunBackup = async () => {
    setOperationLoading(prev => ({ ...prev, backup: true }));
    try {
      const response = await adminAPI.runBackup();
      if (response.status?.ok) {
        toastBus.success(t('backupRunDone', { target: response.status.target || '' }));
      } else {
        setError(response.status?.error || t('backupRunFailed'));
      }
      const data = await adminAPI.getBackups();
      setBackups(data);
    } catch (error) {
      console.error('Error running backup:', error);
      setError(resolveApiErrorMessage(error, t, 'backupRunFailed'));
    } finally {
      setOperationLoading(prev => ({ ...prev, backup: false }));
    }
  };

  const backdropClose = useBackdropClose(onClose);

  // Same dialog semantics as the other overlays: focus trap, initial focus,
  // focus restore and Escape-to-close. The console only mounts while open, so
  // `active` stays true. While a delete confirm is open, the ConfirmDialog on
  // top owns Escape (FriendsModal pattern) — one Escape cancels the confirm,
  // the second closes the console.
  const { containerRef, titleId } = useModalA11y({ onClose, closeOnEscape: !deleteConfirm });

  return (
    <div className="admin-console-overlay" {...backdropClose}>
      <div
        className="admin-console"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="admin-close-btn" title={t('close')} aria-label={t('close')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className="admin-console-header">
          <h2 id={titleId}>🔧 {t('adminConsoleHeader')}</h2>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            📊 {t('statistics')}
          </button>
          <button
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 {t('users')}
          </button>
          <button
            className={`admin-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ {t('settings')}
          </button>
          <button
            className={`admin-tab ${activeTab === 'backups' ? 'active' : ''}`}
            onClick={() => setActiveTab('backups')}
          >
            💾 {t('backups')}
          </button>
        </div>

        <div className="admin-content">
          {error && (
            <div className="admin-error">
              <p>{error}</p>
              <button onClick={() => setError(null)}>{t('close')}</button>
            </div>
          )}

          {loading ? (
            <div className="admin-loading">
              <div className="loading-spinner"></div>
              <p>{t('loadingData')}</p>
            </div>
          ) : (
            <>
              {activeTab === 'stats' && stats && (
                <div className="admin-stats">
                  <div className="stat-card">
                    <h3>{t('overallStats')}</h3>
                    <div className="stat-grid">
                      <div className="stat-item">
                        <span className="stat-label">👥 {t('users')}</span>
                        <span className="stat-value">{stats.totalUsers}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">📝 {t('notes')}</span>
                        <span className="stat-value">{stats.totalNotes}</span>
                      </div>
                      {typeof stats.trashNotes === 'number' && (
                        <div className="stat-item">
                          <span className="stat-label">🗑️ {t('notesInTrash')}</span>
                          <span className="stat-value">{stats.trashNotes}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {stats.topUsers && stats.topUsers.length > 0 && (
                    <div className="stat-card">
                      <h3>{t('topUsersByNotes')}</h3>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>{t('username')}</th>
                            <th>{t('email')}</th>
                            <th>{t('noteCount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.topUsers.map((user) => (
                            <tr key={user._id}>
                              <td>{user.username}</td>
                              <td>{user.email}</td>
                              <td>{user.noteCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {stats.recentUsers && stats.recentUsers.length > 0 && (
                    <div className="stat-card">
                      <h3>{t('recentUsers')}</h3>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>{t('username')}</th>
                            <th>{t('email')}</th>
                            <th>{t('admin')}</th>
                            <th>{t('created')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentUsers.map((user) => (
                            <tr key={user._id}>
                              <td>{user.username}</td>
                              <td>{user.email}</td>
                              <td>{user.isAdmin ? '✓' : ''}</td>
                              <td>{new Date(user.createdAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'users' && (
                <div className="admin-users">
                  {resetTokenInfo && (
                    <div className="reset-token-box" role="status">
                      <strong>{t('resetTokenCreatedTitle')} — {resetTokenInfo.username}</strong>
                      <p className="settings-description">{t('resetTokenHint')}</p>
                      <div className="reset-token-value">
                        <code>{resetTokenInfo.token}</code>
                        <button
                          type="button"
                          className="btn-reset-copy"
                          onClick={handleCopyResetToken}
                        >
                          {resetTokenCopied ? t('copied') : t('copy')}
                        </button>
                        <button
                          type="button"
                          className="btn-reset-dismiss"
                          onClick={() => setResetTokenInfo(null)}
                          aria-label={t('close')}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="admin-users-header">
                    <h3>{t('userManagement')}</h3>
                    <button
                      onClick={() => setShowCreateUser(!showCreateUser)}
                      className="btn-create-user"
                    >
                      {showCreateUser ? `✕ ${t('cancel')}` : `➕ ${t('newUser')}`}
                    </button>
                  </div>

                  {showCreateUser && (
                    <form onSubmit={handleCreateUser} className="create-user-form">
                      <div className="form-grid">
                        <div className="form-group">
                          <label htmlFor="username">{t('username')}</label>
                          <input
                            id="username"
                            type="text"
                            value={newUser.username}
                            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                            placeholder={t('usernamePlaceholder')}
                            required
                            minLength={3}
                            maxLength={50}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="email">{t('email')}</label>
                          <input
                            id="email"
                            type="email"
                            value={newUser.email}
                            onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                            placeholder={t('emailPlaceholder')}
                            required
                            maxLength={254}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="password">{t('password')}</label>
                          <input
                            id="password"
                            type="password"
                            value={newUser.password}
                            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                            placeholder={t('passwordPlaceholder')}
                            required
                            minLength={8}
                            maxLength={128}
                          />
                        </div>
                        <div className="form-group checkbox-group">
                          <label htmlFor="isAdmin">
                            <input
                              id="isAdmin"
                              type="checkbox"
                              checked={newUser.isAdmin}
                              onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                            />
                            <span>{t('createAsAdmin')}</span>
                          </label>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="btn-submit-user"
                        disabled={operationLoading.create}
                      >
                        {operationLoading.create ? t('creating') : `✓ ${t('createUser')}`}
                      </button>
                    </form>
                  )}

                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t('username')}</th>
                        <th>{t('email')}</th>
                        <th>{t('admin')}</th>
                        <th>{t('created')}</th>
                        <th>{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user._id}>
                          <td>{user.username}</td>
                          <td>{user.email}</td>
                          <td>{user.isAdmin ? '✓' : ''}</td>
                          <td>{new Date(user.createdAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</td>
                          <td>
                            <div className="user-actions">
                              <button
                                onClick={() => handleToggleAdmin(user._id)}
                                disabled={operationLoading[user._id]}
                                className="btn-admin-toggle"
                                title={user.isAdmin ? t('removeAdmin') : t('makeAdmin')}
                              >
                                {user.isAdmin ? `🔒 ${t('removeAdmin')}` : `🔓 ${t('makeAdmin')}`}
                              </button>
                              <button
                                onClick={() => handleCreatePasswordReset(user)}
                                disabled={operationLoading[user._id]}
                                className="btn-reset-token"
                                title={t('adminResetPassword')}
                              >
                                🔑 {t('adminResetPassword')}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(user)}
                                disabled={operationLoading[user._id]}
                                className="btn-user-delete"
                                title={t('deleteUser')}
                              >
                                🗑️ {t('delete')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'settings' && settings && (
                <div className="admin-settings">
                  <div className="settings-section">
                    <h3>{t('registration')}</h3>
                    <p className="settings-description">
                      {t('registrationControlDescription')}
                    </p>
                    <div className="setting-item">
                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={settings.registrationEnabled}
                          onChange={handleToggleRegistration}
                          disabled={operationLoading.settings}
                          className="toggle-checkbox"
                        />
                        <span className="toggle-switch"></span>
                        <span className="toggle-text">
                          {settings.registrationEnabled
                            ? t('registrationEnabled')
                            : t('registrationDisabled')}
                        </span>
                      </label>
                      {operationLoading.settings && (
                        <span className="loading-indicator">{t('saving')}</span>
                      )}
                    </div>
                    <p className="settings-note">
                      {settings.registrationEnabled
                        ? `✅ ${t('registrationNote')}`
                        : `🔒 ${t('registrationNoteDisabled')}`}
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'backups' && backups && (
                <div className="admin-backups">
                  <div className="stat-card">
                    <h3>{t('backupStatusTitle')}</h3>
                    {backups.status ? (
                      <div className="stat-grid">
                        <div className="stat-item">
                          <span className="stat-label">🕐 {t('backupLastRun')}</span>
                          <span className="stat-value">
                            {new Date(backups.status.lastRunAt).toLocaleString(locale)}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">{backups.status.ok ? '✓' : '⚠️'} {t('backupResult')}</span>
                          <span className="stat-value">
                            {backups.status.ok ? t('backupOk') : t('backupFailed')}
                          </span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">⏱️ {t('backupDuration')}</span>
                          <span className="stat-value">{(backups.status.durationMs / 1000).toFixed(1)} s</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">🔁 {t('backupInterval')}</span>
                          <span className="stat-value">
                            {t('backupIntervalHours', { hours: backups.status.intervalHours })}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="settings-description">{t('backupNeverRun')}</p>
                    )}
                    {backups.status?.error && (
                      <p className="settings-note">⚠️ {backups.status.error}</p>
                    )}
                    <button
                      onClick={handleRunBackup}
                      className="btn-create-user"
                      disabled={operationLoading.backup}
                      style={{ marginTop: '0.75rem' }}
                    >
                      {operationLoading.backup ? t('saving') : `💾 ${t('backupRunNow')}`}
                    </button>
                    <p className="settings-note">{t('backupRunNote')}</p>
                  </div>

                  {stats?.storage && (
                    <div className="stat-card">
                      <h3>{t('storageTitle')}</h3>
                      <div className="stat-grid">
                        {['uploads', 'backups'].map((volumeKey) => {
                          const volume = stats.storage[volumeKey];
                          if (!volume) return null;
                          return (
                            <div className="stat-item" key={volumeKey}>
                              <span className="stat-label">{volume.path}</span>
                              <span className="stat-value">
                                {volume.ok
                                  ? `${formatBytes(volume.freeBytes)} ${t('storageFree')} / ${formatBytes(volume.totalBytes)}`
                                  : t('storageUnavailable')}
                              </span>
                              {volume.low && (
                                <span className="stat-label">⚠️ {t('storageLow')}</span>
                              )}
                            </div>
                          );
                        })}
                        {stats.uploads && (
                          <div className="stat-item">
                            <span className="stat-label">📎 {t('storageUploads')}</span>
                            <span className="stat-value">
                              {formatBytes((stats.uploads.images || 0) + (stats.uploads.files || 0))}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="stat-card">
                    <h3>{t('backupPointsTitle')}</h3>
                    {!backups.backups || backups.backups.length === 0 ? (
                      <p className="settings-description">{t('backupPointsEmpty')}</p>
                    ) : (
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>{t('backupName')}</th>
                            <th>{t('created')}</th>
                            <th>{t('backupDocuments')}</th>
                            <th>{t('backupUploadFiles')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backups.backups.map((entry) => (
                            <tr key={entry.name}>
                              <td>{entry.name}</td>
                              <td>
                                {entry.createdAt
                                  ? new Date(entry.createdAt).toLocaleString(locale)
                                  : '—'}
                              </td>
                              <td>{entry.unreadable ? '⚠️' : (entry.documents ?? '—')}</td>
                              <td>
                                {entry.unreadable
                                  ? '⚠️'
                                  : (entry.uploadBytes != null
                                    ? `${entry.uploadFiles ?? 0} (${formatBytes(entry.uploadBytes)})`
                                    : '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title={t('deleteUserConfirm')}
          message={t('deleteUserMessage', { username: deleteConfirm.username })}
          onConfirm={() => handleDeleteUser(deleteConfirm._id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

export default AdminConsole;
