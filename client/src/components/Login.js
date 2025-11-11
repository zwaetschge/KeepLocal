import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './Auth.css';

function Login({ onLogin, onSwitchToRegister }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    // Check if registration is enabled
    const checkRegistrationStatus = async () => {
      try {
        const response = await fetch('/api/auth/registration-status');
        if (response.ok) {
          const data = await response.json();
          setRegistrationEnabled(data.registrationEnabled);
        }
      } catch (error) {
        console.error('Error checking registration status:', error);
      }
    };

    checkRegistrationStatus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError(t('fillAllFields'));
      return;
    }

    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err.message || t('loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <h1>📝 KeepLocal</h1>
          <p>{t('loginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">{t('email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              disabled={loading}
              autoComplete="email"
              autoFocus
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
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={loading}
          >
            {loading ? t('loggingIn') : t('login')}
          </button>
        </form>

        {registrationEnabled && (
          <div className="auth-footer">
            <p>
              {t('noAccount')}{' '}
              <button
                type="button"
                className="auth-link"
                onClick={onSwitchToRegister}
                disabled={loading}
              >
                {t('registerNow')}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;
