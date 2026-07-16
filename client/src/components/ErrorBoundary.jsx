import React from 'react';
import './ErrorBoundary.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(_error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console in development
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    this.setState({
      error,
      errorInfo
    });

    // Here you could also log to an error reporting service
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });

    // Reload the page to reset the app
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h1>😔 Etwas ist schiefgelaufen</h1>
            <p className="error-boundary-message">
              Die Anwendung ist auf einen unerwarteten Fehler gestoßen.
            </p>

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
              <button onClick={this.handleReset} className="error-boundary-button">
                Anwendung neu laden
              </button>
              <button
                onClick={() => window.history.back()}
                className="error-boundary-button error-boundary-button-secondary"
              >
                Zurück
              </button>
            </div>

            <p className="error-boundary-help">
              Wenn das Problem weiterhin besteht, versuchen Sie:
            </p>
            <ul className="error-boundary-suggestions">
              <li>Browser-Cache leeren</li>
              <li>Auf einem anderen Browser versuchen</li>
              <li>Den Support kontaktieren</li>
            </ul>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
