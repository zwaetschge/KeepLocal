import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './Auth.css';

/**
 * OAuthCallback handles the redirect from the OAuth provider.
 * It extracts the JWT token from the URL query params and passes it
 * to the parent via onOAuthSuccess, or shows an error.
 */
function OAuthCallback({ onOAuthSuccess }) {
  const { t } = useLanguage();
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const errorParam = params.get('error');

    if (errorParam) {
      setError(t('oauthFailed') || 'OAuth login failed. Please try again.');
      // Clean up URL
      window.history.replaceState({}, document.title, '/');
      return;
    }

    if (token) {
      // Clean up URL before calling success handler
      window.history.replaceState({}, document.title, '/');
      onOAuthSuccess(token);
    } else {
      setError(t('oauthFailed') || 'OAuth login failed. No token received.');
      window.history.replaceState({}, document.title, '/');
    }
  }, [onOAuthSuccess, t]);

  if (error) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="auth-header">
            <h1>OAuth</h1>
          </div>
          <div className="auth-error" role="alert">{error}</div>
          <button
            className="auth-button"
            style={{ marginTop: '16px' }}
            onClick={() => window.location.href = '/'}
          >
            {t('backToLogin') || 'Back to Login'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <div className="auth-header">
          <h1>{t('loggingIn') || 'Logging in...'}</h1>
        </div>
      </div>
    </div>
  );
}

export default OAuthCallback;
