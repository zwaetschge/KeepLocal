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
      const watchInstalling = (installing) => {
        if (!installing) return;
        const announceInstalled = () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) announceWaiting(installing);
        };
        installing.addEventListener('statechange', announceInstalled);
        announceInstalled();
      };
      // Attach before update(): updatefound may fire before its promise resolves.
      registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
      watchInstalling(registration.installing);
      if (registration.waiting) announceWaiting(registration.waiting);
      if (typeof registration?.update === 'function') {
        await registration.update();
      }
      if (registration.waiting) announceWaiting(registration.waiting);
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  }, { once: true });
}
