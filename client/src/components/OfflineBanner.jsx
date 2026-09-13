import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './OfflineBanner.css';

/**
 * Sichtbarer Offline-Zustand.
 *
 * Ohne ihn war Offline der stillste Zustand der App: Der 60-Sekunden-Poll lief
 * mit `silent: true` weiter, ein fehlgeschlagenes Speichern zeigte nur
 * „Error updating note", und die Liste blieb ohne jeden Hinweis stehen. Für eine
 * als „lokale Notizen" positionierte App ist ein Tunnel/WLAN-Wechsel der
 * häufigste Alltagsfall.
 */
export function OfflineBanner({ onRetry }) {
  const { t } = useLanguage();
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span className="offline-banner-text">{t('offlineBanner')}</span>
      {onRetry && (
        <button type="button" className="offline-banner-retry" onClick={onRetry}>
          {t('offlineRetry')}
        </button>
      )}
    </div>
  );
}

export default OfflineBanner;
