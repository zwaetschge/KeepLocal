import { useEffect, useRef, useState } from 'react';
import { createOnlineTracker } from '../utils/onlineStatus.mjs';

/**
 * Verbindungsstatus der App. Ein Tracker pro Aufruf, Events werden beim
 * Entmounten wieder abgemeldet (die Audit-Runden hatten wiederholt
 * Listener-Leaks: `useKeyboardShortcuts` meldete bei jedem Render neu an).
 *
 * @returns {boolean} true = online (oder unbekannt), false = sicher offline
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);

  useEffect(() => {
    const tracker = createOnlineTracker();
    setOnline(tracker.isOnline());
    const unsubscribe = tracker.subscribe(setOnline);
    return () => {
      unsubscribe();
      tracker.destroy();
    };
  }, []);

  return online;
}


/**
 * Verbindungsstatus plus „einmal nachziehen beim Wiederverbinden".
 *
 * Die Logik lebt hier und nicht in App.jsx: Ohne sie bleibt die Liste auf dem
 * Stand von vor dem Tunnel stehen, und niemand weiß, ob die letzte Änderung
 * gespeichert wurde. App.jsx darf keine Geschäftslogik zurückholen
 * (guard in client/tests/notesManagerLogic.test.js).
 *
 * @param {Object} options
 * @param {boolean} [options.enabled] nur nachziehen, wenn eingeloggt
 * @param {() => void} [options.onReconnect] Callback beim Wechsel offline → online
 * @returns {boolean} isOnline
 */
export function useOnlineRefresh({ enabled = true, onReconnect = null } = {}) {
  const isOnline = useOnlineStatus();
  const wasOfflineRef = useRef(false);
  // Callback in einem Ref, damit der Effekt nicht bei jedem Render neu läuft
  // (die Audit-Runden hatten genau dieses Muster als Listener-Leak).
  const callbackRef = useRef(onReconnect);
  callbackRef.current = onReconnect;

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    if (enabled) callbackRef.current?.();
  }, [isOnline, enabled]);

  return isOnline;
}

export default useOnlineStatus;
