import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './Auth.css';

/**
 * OAuthCallback handles the redirect from the OAuth provider.
 * The server stores the session in an HttpOnly cookie. This component only
 * confirms the callback result and asks the auth context to load the user.
 */
function OAuthCallback({ onOAuthSuccess }) {
  const { t } = useLanguage();
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const success = fragment.get('success');
    const errorParam = params.get('error');

    if (errorParam) {
      setError(t('oauthFailed') || 'OAuth login failed. Please try again.');
      // Clean up URL
      window.history.replaceState({}, document.title, '/');
      return;
    }

    if (success === '1') {
      // Clean up URL before calling success handler
      window.history.replaceState({}, document.title, '/');
      onOAuthSuccess();
    } else {
      setError(t('oauthFailed') || 'OAuth login failed. No session confirmation received.');
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
