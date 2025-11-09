import React, { useState } from 'react';
import './Auth.css';

function Setup({ onSetup }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validatePassword = (pwd) => {
    if (pwd.length < 8) {
      return 'Passwort muss mindestens 8 Zeichen lang sein';
    }
    if (!/[a-z]/.test(pwd)) {
      return 'Passwort muss mindestens einen Kleinbuchstaben enthalten';
    }
    if (!/[A-Z]/.test(pwd)) {
      return 'Passwort muss mindestens einen Großbuchstaben enthalten';
    }
    if (!/[0-9]/.test(pwd)) {
      return 'Passwort muss mindestens eine Zahl enthalten';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !email || !password || !confirmPassword) {
      setError('Bitte füllen Sie alle Felder aus');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    try {
      await onSetup(username, email, password);
    } catch (err) {
      setError(err.message || 'Setup fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <h1>🔧 KeepLocal Setup</h1>
          <p>Erstellen Sie Ihr Administrator-Konto</p>
          <div className="setup-info">
            <p style={{ fontSize: '0.9em', marginTop: '1rem', color: 'var(--text-secondary)' }}>
              Dies ist die erste Anmeldung. Bitte erstellen Sie ein Administrator-Konto, um KeepLocal zu verwenden.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Benutzername</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              disabled={loading}
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={50}
              pattern="[a-zA-Z0-9_\-]+"
              title="Nur Buchstaben, Zahlen, Bindestriche und Unterstriche"
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">E-Mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              disabled={loading}
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <small className="form-hint">
              Mindestens 8 Zeichen, ein Groß- und Kleinbuchstabe, eine Zahl
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Passwort bestätigen</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? 'Setup läuft...' : 'Admin-Konto erstellen'}
          </button>
        </form>

        <div className="auth-footer">
          <p style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>
            Nach dem Setup können Sie weitere Benutzer über die normale Registrierung hinzufügen.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Setup;
