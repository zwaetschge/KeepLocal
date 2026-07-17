import React from 'react';
import './ErrorBoundary.css';
import { repairAppCaches } from '../utils/appRecovery.mjs';
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
      await repairAppCaches();
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
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>
              <span className="error-boundary-mark" aria-hidden="true">!</span>
              Etwas ist schiefgelaufen
            </h1>
            <p className="error-boundary-message">
              Die Anwendung ist auf einen unerwarteten Fehler gestoßen.
            </p>

            {this.state.diagnostic && (
              <p className="error-boundary-diagnostic">
                Diagnose: <code>{this.state.diagnostic.code}</code>
                {' · '}{this.state.diagnostic.name}
              </p>
            )}

            {import.meta.env.DEV && this.state.error && (
              <details className="error-boundary-details">
                <summary>Fehlerdetails (nur in Entwicklung sichtbar)</summary>
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
                {this.state.isRepairing ? 'App wird aktualisiert …' : 'App sicher aktualisieren'}
              </button>
              <button
                onClick={this.handleReset}
                className="error-boundary-button error-boundary-button-secondary"
              >
                Nur neu laden
              </button>
            </div>

            {this.state.isRepairing && (
              <p className="error-boundary-status" role="status">
                Alte App-Dateien werden entfernt und frisch geladen.
              </p>
            )}
            {this.state.repairFailed && (
              <p className="error-boundary-status error-boundary-status-error" role="alert">
                Die automatische Aktualisierung wurde blockiert. Bitte laden Sie die Seite neu.
              </p>
            )}

            <p className="error-boundary-help">
              „App sicher aktualisieren“ erneuert nur die Web-App. Konto und Notizen bleiben erhalten.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
