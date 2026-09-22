import { useEffect } from 'react';

/**
 * PWA-Update-Prompt (v1.16.0).
 *
 * Bis v1.15 rief der Service Worker bei der Installation sofort skipWaiting()
 * und clients.claim(): Ein Deploy griff mitten in laufenden Sessions um — der
 * Tab lief weiter auf altem Bundle, die nächsten Navigationen auf neuem — und
 * niemand bekam etwas mit. Jetzt wartet der neue Worker als „waiting“:
 *
 * 1. index.jsx meldet einen wartenden Worker als `keeplocal:update-available`.
 * 2. Dieser Hook zeigt einen Toast mit „Jetzt laden“-Button.
 * 3. Der Klick schickt SKIP_WAITING an den Worker; erst controllerchange
 *    (der Worker übernimmt) lädt die Seite genau einmal neu.
 */
export function useUpdatePrompt({ showToast, t }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;

    let pendingWorker = null;
    let reloadGuard = false;

    // controllerchange feuert nur noch nach dem Klick (install ruft kein
    // skipWaiting mehr) — trotzdem einmalig bleiben, der Change kann in
    // Theorie zweimal emittiert werden.
    const reloadOnce = () => {
      if (reloadGuard) return;
      reloadGuard = true;
      window.location.reload();
    };

    const onUpdateAvailable = (event) => {
      pendingWorker = event?.detail?.sw ?? null;
      showToast(t('updateAvailable'), 'info', {
        // Lange, aber nicht ewig: Nach einer Minute hat sich das Update
        // vermutlich erledigt (Tab-Neustart holt es ohnehin).
        duration: 60000,
        action: {
          label: t('updateNow'),
          onClick: () => {
            pendingWorker?.postMessage?.({ type: 'SKIP_WAITING' });
          }
        }
      });
    };

    window.addEventListener('keeplocal:update-available', onUpdateAvailable);
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    return () => {
      window.removeEventListener('keeplocal:update-available', onUpdateAvailable);
      navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
    };
  }, [showToast, t]);
}

export default useUpdatePrompt;
