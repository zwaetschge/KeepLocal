import React, { useState } from 'react';
import './Auth.css';
import LanguageSelector from './LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

function Register({ onRegister, onSwitchToLogin }) {
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validatePassword = (pwd) => {
    if (pwd.length < 8) {
      return t('passwordMinLength');
    }
    if (pwd.length > 128) {
      return t('passwordMaxLength');
    }
    if (!/[a-z]/.test(pwd)) {
      return t('passwordNeedsLower');
    }
    if (!/[A-Z]/.test(pwd)) {
      return t('passwordNeedsUpper');
    }
    if (!/[0-9]/.test(pwd)) {
      return t('passwordNeedsNumber');
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !email || !password || !confirmPassword) {
      setError(t('fillAllFields'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('passwordsDontMatch'));
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);

    try {
      await onRegister(username, email, password);
    } catch (err) {
      setError(resolveApiErrorMessage(err, t, 'registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-language"><LanguageSelector /></div>
      <div className="auth-box">
        <div className="auth-header">
          <h1>📝 KeepLocal</h1>
          <p>{t('createAccountSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">{t('username')}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('usernamePlaceholder')}
              disabled={loading}
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={50}
              pattern="[a-zA-Z0-9_\-]+"
              title={t('usernamePatternTitle')}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">{t('email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ihre@email.de"
              disabled={loading}
              autoComplete="email"
              maxLength={254}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('password')}</label>
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
              maxLength={128}
            />
            <small className="form-hint">
              {t('passwordRuleHint')}
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">{t('confirmPasswordLabel')}</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="new-password"
              required
              maxLength={128}
            />
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? t('registering') : t('register')}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {t('haveAccount')}{' '}
            <button
              type="button"
              className="auth-link"
              onClick={onSwitchToLogin}
              disabled={loading}
            >
              {t('loginNow')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;
