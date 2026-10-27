import React, { useEffect, useState } from 'react';
import { outbox } from '../services/api/offlineNotes';
import { useLanguage } from '../contexts/LanguageContext';
export default function OutboxStatus() {
  const { t } = useLanguage();
  const [ops, setOps] = useState([]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      outbox.snapshot().then((s) => {
        if (active) setOps(s.ops);
      });
    const listener = (e) => {
      if (e.detail?.owner === outbox.owner)
        outbox.snapshot().then((s) => {
          if (active) setOps(s.ops);
        });
    };
    refresh();
    window.addEventListener('keeplocal-outbox', listener);
    return () => {
      active = false;
      window.removeEventListener('keeplocal-outbox', listener);
    };
  }, []);
  if (!ops.length) return null;
  const saveCopy = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(ops, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keeplocal-offline-notes.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <aside className="offline-banner" role="status">
      <span>
        {t('keepPendingWrites').replace('{count}', ops.length)}{' '}
        {ops[0].error && `${t('keepSyncBlocked')} (${ops[0].error.status})`}
      </span>
      <button onClick={() => outbox.flush()}>{t('offlineRetry')}</button>
      <button onClick={saveCopy}>{t('keepSaveCopy')}</button>
      {ops[0].error && (
        <button
          onClick={() => {
            if (window.confirm(t('keepDiscardQueued')))
              outbox.discard(ops[0].id);
          }}
        >
          {t('delete')}
        </button>
      )}
    </aside>
  );
}
