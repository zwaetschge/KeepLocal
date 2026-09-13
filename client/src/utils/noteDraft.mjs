// Editor-Entwürfe: überleben Sitzungsablauf, Crash, Reload und Tab-Absturz.
//
// Warum (Audit 2026-09-12, Top-30 Nr. 16): Der gesamte Editor-Zustand lebte in
// React-State, `rg localStorage client/src/components/NoteModal.jsx` hatte keine
// Treffer. Vier realistische Pfade kosteten das gerade Getippte komplett:
//   - 401 (7-Tage-Session, `sessionVersion`-Bump durch Passwortwechsel auf einem
//     anderen Gerät, Admin-Reset-Token) → AuthContext loggt aus → App rendert den
//     Login-Screen → der Editor wird entmountet.
//   - ErrorBoundary: `handleReset` endet in `window.location.reload()` — genau die
//     Crash-Klasse, die in drei Audit-Runden hintereinander auftrat.
//   - Reload/Tab-Close/Absturz: kein `pagehide`, keine Kopie.
//   - `Ctrl+Shift+L` loggt ohne Rückfrage aus.
//
// Reines Modul (kein React), damit `node --test` die Logik ausführen kann.
// Storage-Zugriff läuft über utils/localStorage.mjs (try/catch-gekapselt,
// Privat-Modus-sicher) und ist injizierbar.

import { readLocalStorage, writeLocalStorage } from './localStorage.mjs';

export const DRAFT_STORAGE_KEY = 'keeplocal_drafts';
/** Hart begrenzt: kein unbounded Wachstum im localStorage. */
export const MAX_DRAFTS = 10;
export const MAX_ENTRY_BYTES = 10 * 1024;

/** Felder, die einen Entwurf ausmachen. */
export const DRAFT_FIELDS = ['title', 'content', 'tags', 'todoItems', 'isTodoList', 'color'];

const byteLength = (value) => {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return String(value).length;
  }
};

/**
 * Konto-Isolation: Am gemeinsamen Rechner darf der nächste Nutzer keine fremden
 * Entwürfe angeboten bekommen (dieselbe Begründung wie bei den konto-gebundenen
 * Einstellungen aus PR #108).
 */
export function draftKey(noteId, userId) {
  return `${userId || 'anonymous'}:${noteId || 'new'}`;
}

export function readAllDrafts(storage) {
  const raw = readLocalStorage(DRAFT_STORAGE_KEY, null, storage);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readDraft(noteId, userId, storage) {
  const entry = readAllDrafts(storage)[draftKey(noteId, userId)];
  return entry && typeof entry === 'object' ? entry : null;
}

function pickDraftFields(draft) {
  const picked = {};
  for (const field of DRAFT_FIELDS) {
    if (draft[field] !== undefined) picked[field] = draft[field];
  }
  return picked;
}

/**
 * Schreibt einen Entwurf. Zu große Einträge werden beim Inhalt gekürzt statt
 * verworfen — ein halber Entwurf ist besser als keiner, und ein einzelner
 * riesiger Eintrag darf nicht die übrigen Entwürfe verdrängen.
 */
export function writeDraft(noteId, userId, draft, storage) {
  const key = draftKey(noteId, userId);
  const entry = {
    ...pickDraftFields(draft || {}),
    savedAt: Number(draft?.savedAt) || Date.now(),
    noteUpdatedAt: draft?.noteUpdatedAt || null
  };

  let serialized = JSON.stringify({ ...entry });
  if (byteLength(serialized) > MAX_ENTRY_BYTES && typeof entry.content === 'string') {
    let content = entry.content;
    while (content.length > 0 && byteLength(JSON.stringify({ ...entry, content })) > MAX_ENTRY_BYTES) {
      content = content.slice(0, Math.max(0, Math.floor(content.length * 0.8)));
    }
    entry.content = content;
    entry.truncated = true;
  }
  serialized = JSON.stringify({ ...entry });
  if (byteLength(serialized) > MAX_ENTRY_BYTES) {
    return null; // z. B. riesige Todo-Liste: nichts schreiben statt alles verdrängen
  }

  const all = readAllDrafts(storage);
  all[key] = entry;

  const keys = Object.keys(all).sort((a, b) => (all[b]?.savedAt || 0) - (all[a]?.savedAt || 0));
  for (const stale of keys.slice(MAX_DRAFTS)) {
    delete all[stale];
  }

  return writeLocalStorage(DRAFT_STORAGE_KEY, JSON.stringify(all), storage) ? entry : null;
}

export function clearDraft(noteId, userId, storage) {
  const all = readAllDrafts(storage);
  const key = draftKey(noteId, userId);
  if (!(key in all)) return false;
  delete all[key];
  return writeLocalStorage(DRAFT_STORAGE_KEY, JSON.stringify(all), storage);
}

/** Alle Entwürfe eines Kontos entfernen (Logout am gemeinsamen Rechner). */
export function clearDraftsForUser(userId, storage) {
  const all = readAllDrafts(storage);
  const prefix = `${userId || 'anonymous'}:`;
  const remaining = Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(prefix)));
  const removed = Object.keys(all).length - Object.keys(remaining).length;
  writeLocalStorage(DRAFT_STORAGE_KEY, JSON.stringify(remaining), storage);
  return removed;
}

function normalize(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Unterscheidet sich der Entwurf inhaltlich vom aktuellen Stand der Notiz? */
export function draftDiffers(draft, note) {
  if (!draft) return false;
  for (const field of DRAFT_FIELDS) {
    const draftValue = normalize(draft[field]);
    const noteValue = normalize(note?.[field]);
    if (draftValue !== noteValue) return true;
  }
  return false;
}

/**
 * Lohnt sich das Anbieten? Nur wenn der Entwurf inhaltlich abweicht UND neuer ist
 * als der Server-Stand — sonst würde nach dem Speichern beim nächsten Öffnen
 * derselbe Inhalt als „Entwurf" angeboten.
 */
export function isDraftWorthRestoring(draft, note) {
  if (!draft || !draftDiffers(draft, note)) return false;
  if (!note?.updatedAt) return true; // neue Notiz: es gibt keinen Server-Stand
  const savedAt = Number(draft.savedAt) || 0;
  const serverUpdatedAt = Date.parse(note.updatedAt);
  if (!Number.isFinite(serverUpdatedAt)) return true;
  return savedAt >= serverUpdatedAt;
}

const noteDraft = {
  DRAFT_STORAGE_KEY,
  MAX_DRAFTS,
  MAX_ENTRY_BYTES,
  DRAFT_FIELDS,
  draftKey,
  readAllDrafts,
  readDraft,
  writeDraft,
  clearDraft,
  clearDraftsForUser,
  draftDiffers,
  isDraftWorthRestoring
};
export default noteDraft;
