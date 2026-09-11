import React from 'react';
import './ErrorBoundary.css';
import { repairAppState } from '../utils/appRecovery.mjs';
import { de } from '../translations/de';
import { en } from '../translations/en';
import { readLocalStorage } from '../utils/localStorage.mjs';
import { getBrowserLanguage } from '../utils/browserLanguage.mjs';

// ErrorBoundary sitzt außerhalb des LanguageProvider und kann useLanguage
// nicht nutzen — die Sprache wird daher direkt aus dem Storage bzw. Browser
// erkannt (gleiche Keys wie in translations/de.js und en.js).
const resolveBoundaryMessages = () => {
  const catalogs = { de, en };
  const stored = readLocalStorage('keeplocal_language');
  const language = catalogs[stored] ? stored : getBrowserLanguage(catalogs, 'de');
  const messages = catalogs[language] || de;
  return (key) => messages[key] || de[key] || key;
};
import { buildErrorDiagnostic } from '../utils/errorDiagnostic.mjs';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      diagnostic: null,
      isRepairing: false,
      repairFailed: false
    };
  }

  static getDerivedStateFromError(_error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
      diagnostic: buildErrorDiagnostic(error, errorInfo)
    });

    // Here you could also log to an error reporting service
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      diagnostic: null,
      isRepairing: false,
      repairFailed: false
    });

    // Reload the page to reset the app
    window.location.reload();
  };

  handleRepair = async () => {
    if (this.state.isRepairing) return;

    this.setState({ isRepairing: true, repairFailed: false });

    try {
      await repairAppState();
      const url = new URL(window.location.href);
      url.searchParams.set('app-repair', Date.now().toString(36));
      window.location.replace(url.toString());
    } catch (error) {
      console.error('App recovery failed:', error);
      this.setState({ isRepairing: false, repairFailed: true });
    }
  };

  render() {
    if (this.state.hasError) {
      const t = resolveBoundaryMessages();
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>
              <span className="error-boundary-mark" aria-hidden="true">!</span>
              {t('errorTitle')}
            </h1>
            <p className="error-boundary-message">
              {t('errorBoundaryDescription')}
            </p>

            {this.state.diagnostic && (
              <div className="error-boundary-diagnostics">
                <p className="error-boundary-diagnostic">
                  {t('diagnosisLabel')}: <code>{this.state.diagnostic.code}</code>
                  {' · '}{this.state.diagnostic.name}
                </p>
                {this.state.diagnostic.message && (
                  <p className="error-boundary-hint">
                    {t('technicalHint')}: <code>{this.state.diagnostic.message}</code>
                  </p>
                )}
              </div>
            )}

            {import.meta.env.DEV && this.state.error && (
              <details className="error-boundary-details">
                <summary>{t('errorDetailsDevOnly')}</summary>
                <pre className="error-boundary-stack">
                  <strong>Error:</strong> {this.state.error.toString()}
                  {this.state.errorInfo && (
                    <>
                      <br /><br />
                      <strong>Component Stack:</strong>
                      {this.state.errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}

            <div className="error-boundary-actions">
              <button
                onClick={this.handleRepair}
                className="error-boundary-button"
                disabled={this.state.isRepairing}
              >
                {this.state.isRepairing ? t('repairingButton') : t('repairButton')}
              </button>
              <button
                onClick={this.handleReset}
                className="error-boundary-button error-boundary-button-secondary"
              >
                {t('reloadOnlyButton')}
              </button>
            </div>

            {this.state.isRepairing && (
              <p className="error-boundary-status" role="status">
                {t('repairingStatus')}
              </p>
            )}
            {this.state.repairFailed && (
              <p className="error-boundary-status error-boundary-status-error" role="alert">
                {t('repairBlockedStatus')}
              </p>
            )}

            <p className="error-boundary-help">
              {t('repairHelpText')}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
