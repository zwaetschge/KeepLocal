import { NoteOutbox } from '../../utils/noteOutbox.mjs';
import { fetchWithAuth } from './apiUtils';
let database;
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('keeplocal-notes', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function record(owner, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      'accounts',
      value === undefined ? 'readonly' : 'readwrite',
    );
    const store = tx.objectStore('accounts');
    const request =
      value === undefined
        ? store.get(owner)
        : value === null
          ? store.delete(owner)
          : store.put(value, owner);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const outbox = new NoteOutbox({
  load: (owner) => record(owner),
  save: (owner, state) => record(owner, state),
  online: () => navigator.onLine,
  send: (kind, id, body) =>
    fetchWithAuth(kind === 'create' ? '/api/notes' : `/api/notes/${id}`, {
      method: { create: 'POST', update: 'PUT', delete: 'DELETE' }[kind],
      ...(kind !== 'delete' && {
        body: JSON.stringify({ ...body, personalOrganization: true }),
      }),
    }),
  notify: (state, owner) =>
    window.dispatchEvent(
      new CustomEvent('keeplocal-outbox', {
        detail: {
          owner,
          pending: state?.ops.length || 0,
          blocked: state?.ops[0]?.error,
        },
      }),
    ),
});
export function setOfflineAccount(user) {
  outbox.setOwner(user?._id || user?.id);
}
export async function clearOfflineAccount(owner) {
  outbox.setOwner(null);
  await outbox.tail.catch(() => {});
  if (owner) await record(owner, null).catch(() => {});
}
export function cachedRead(key, fetcher) {
  const owner = outbox.owner;
  return fetcher()
    .then((response) => outbox.cacheList(key, response, owner))
    .catch((error) => {
      if (error.status || error.code === 'ABORTED') throw error;
      return outbox.cachedList(key, owner);
    });
}
window.addEventListener('online', () =>
  outbox
    .flush()
    .then(() => window.dispatchEvent(new Event('keeplocal-outbox-flushed')))
    .catch(() => {}),
);
