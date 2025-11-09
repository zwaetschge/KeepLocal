import React, { useState, useEffect } from 'react';
import './AdminConsole.css';
import { adminAPI } from '../services/api';
import ConfirmDialog from './ConfirmDialog';

function AdminConsole({ onClose }) {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('stats');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [operationLoading, setOperationLoading] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      if (activeTab === 'stats') {
        const data = await adminAPI.getStats();
        setStats(data.stats);
      } else if (activeTab === 'users') {
        const data = await adminAPI.getUsers();
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Error loading admin data:', error);
      setError(error.message || 'Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    setOperationLoading(prev => ({ ...prev, [userId]: 'delete' }));
    try {
      await adminAPI.deleteUser(userId);
      setUsers(users.filter(u => u._id !== userId));
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      setError(error.message || 'Fehler beim Löschen des Benutzers');
    } finally {
      setOperationLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleToggleAdmin = async (userId) => {
    setOperationLoading(prev => ({ ...prev, [userId]: 'admin' }));
    try {
      const response = await adminAPI.toggleUserAdmin(userId);
      setUsers(users.map(u =>
        u._id === userId ? { ...u, isAdmin: response.user.isAdmin } : u
      ));
    } catch (error) {
      console.error('Error toggling admin status:', error);
      setError(error.message || 'Fehler beim Ändern des Admin-Status');
    } finally {
      setOperationLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  return (
    <div className="admin-console-overlay" onClick={onClose}>
      <div className="admin-console" onClick={(e) => e.stopPropagation()}>
        <div className="admin-console-header">
          <h2>🔧 Admin-Konsole</h2>
          <button onClick={onClose} className="admin-close-btn" title="Schließen">
            ✕
          </button>
        </div>

        <div className="admin-tabs">
          <button
            className={`admin-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            📊 Statistiken
          </button>
          <button
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 Benutzer
          </button>
        </div>

        <div className="admin-content">
          {error && (
            <div className="admin-error">
              <p>{error}</p>
              <button onClick={() => setError(null)}>Schließen</button>
            </div>
          )}

          {loading ? (
            <div className="admin-loading">
              <div className="loading-spinner"></div>
              <p>Lade Daten...</p>
            </div>
          ) : (
            <>
              {activeTab === 'stats' && stats && (
                <div className="admin-stats">
                  <div className="stat-card">
                    <h3>Gesamtstatistik</h3>
                    <div className="stat-grid">
                      <div className="stat-item">
                        <span className="stat-label">👥 Benutzer</span>
                        <span className="stat-value">{stats.totalUsers}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">📝 Notizen</span>
                        <span className="stat-value">{stats.totalNotes}</span>
                      </div>
                    </div>
                  </div>

                  {stats.topUsers && stats.topUsers.length > 0 && (
                    <div className="stat-card">
                      <h3>Top Benutzer (nach Notizen)</h3>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Benutzername</th>
                            <th>E-Mail</th>
                            <th>Notizen</th>
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
                      <h3>Neueste Benutzer</h3>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Benutzername</th>
                            <th>E-Mail</th>
                            <th>Admin</th>
                            <th>Erstellt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentUsers.map((user) => (
                            <tr key={user._id}>
                              <td>{user.username}</td>
                              <td>{user.email}</td>
                              <td>{user.isAdmin ? '✓' : ''}</td>
                              <td>{new Date(user.createdAt).toLocaleDateString('de-DE')}</td>
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
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Benutzername</th>
                        <th>E-Mail</th>
                        <th>Admin</th>
                        <th>Erstellt</th>
                        <th>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user._id}>
                          <td>{user.username}</td>
                          <td>{user.email}</td>
                          <td>{user.isAdmin ? '✓' : ''}</td>
                          <td>{new Date(user.createdAt).toLocaleDateString('de-DE')}</td>
                          <td>
                            <div className="user-actions">
                              <button
                                onClick={() => handleToggleAdmin(user._id)}
                                disabled={operationLoading[user._id]}
                                className="btn-admin-toggle"
                                title={user.isAdmin ? 'Admin-Rechte entziehen' : 'Zum Admin ernennen'}
                              >
                                {user.isAdmin ? '🔒 Admin entfernen' : '🔓 Admin machen'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(user)}
                                disabled={operationLoading[user._id]}
                                className="btn-user-delete"
                                title="Benutzer löschen"
                              >
                                🗑️ Löschen
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Benutzer löschen?"
          message={`Möchten Sie den Benutzer "${deleteConfirm.username}" wirklich löschen? Alle Notizen dieses Benutzers werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`}
          onConfirm={() => handleDeleteUser(deleteConfirm._id)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

export default AdminConsole;
