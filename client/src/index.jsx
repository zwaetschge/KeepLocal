import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/dm-sans/wght-italic.css';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/jetbrains-mono';
// P14: nur der lateinische Schriftschnitt (latin) statt aller Subsets
import '@fontsource/delius-swash-caps/latin.css';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        '/service-worker.js',
        { updateViaCache: 'none' }
      );
      if (typeof registration?.update === 'function') {
        await registration.update();
      }
      // Update-Prompt (v1.16.0): Der Worker installiert ohne skipWaiting — er
      // wartet. Hier wird ein wartender Worker als Event gemeldet; die App
      // (useUpdatePrompt) zeigt den Toast, erst dessen Klick schickt
      // SKIP_WAITING.
      const announceWaiting = (worker) => {
        if (!worker) return;
        window.dispatchEvent(
          new CustomEvent('keeplocal:update-available', { detail: { sw: worker } })
        );
      };
      if (registration.waiting) {
        announceWaiting(registration.waiting);
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // „installed“ + aktiver Controller = Update neben einer laufenden
          // Seite (ohne Controller wäre es die allererste Installation).
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            announceWaiting(installing);
          }
        });
      });
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  }, { once: true });
}
