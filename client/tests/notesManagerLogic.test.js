const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Dynamischer Import der reinen Logik aus dem neuen Core-Hook (P20-Anteil).
// useNotesManager.js importiert dafür nur react + notesPayload.mjs und bekommt
// die API injiziert, sodass node --test ohne Browser-APIs auskommt.
const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/hooks/useNotesManager.js')
).href;

const note = (overrides = {}) => ({
  _id: 'note-1',
  title: 'Titel',
  content: 'Inhalt',
  updatedAt: '2026-01-01T10:00:00.000Z',
  isPinned: false,
  isArchived: false,
  ...overrides,
});

test('applyMutationLocally: create prepends a visible note and keeps the list immutable', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const existing = [note()];
  const created = note({ _id: 'note-2' });

  const next = applyMutationLocally(existing, { type: 'create', note: created });

  assert.equal(next.length, 2);
  assert.equal(next[0]._id, 'note-2');
  assert.equal(next[1]._id, 'note-1');
  assert.equal(existing.length, 1, 'original list must not be mutated');
});

test('applyMutationLocally: create stays invisible when the view does not match', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const existing = [note()];

  const next = applyMutationLocally(existing, {
    type: 'create',
    note: note({ _id: 'note-2' }),
    visible: false,
  });

  assert.strictEqual(next, existing, 'archived note must not enter the active view');
});

test('applyMutationLocally: create with an existing id replaces instead of duplicating', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const existing = [note(), note({ _id: 'note-2' })];
  const replacement = note({ _id: 'note-2', title: 'Neu' });

  const next = applyMutationLocally(existing, { type: 'create', note: replacement });

  assert.equal(next.length, 2);
  assert.equal(next[1].title, 'Neu');
});

test('applyMutationLocally: update replaces the matching note and preserves the rest by reference', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const first = note();
  const second = note({ _id: 'note-2' });
  const updated = note({ _id: 'note-2', title: 'Geändert', updatedAt: '2026-02-01T10:00:00.000Z' });

  const next = applyMutationLocally([first, second], { type: 'update', note: updated });

  assert.equal(next.length, 2);
  assert.strictEqual(next[0], first);
  assert.equal(next[1].title, 'Geändert');
});

test('applyMutationLocally: update for an unknown id is a no-op', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const existing = [note()];

  const next = applyMutationLocally(existing, { type: 'update', note: note({ _id: 'unbekannt' }) });

  assert.strictEqual(next, existing);
});

test('applyMutationLocally: delete removes exactly the target note', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const first = note();
  const second = note({ _id: 'note-2' });

  const next = applyMutationLocally([first, second], { type: 'delete', id: 'note-2' });

  assert.deepEqual(next.map(n => n._id), ['note-1']);
});

test('applyMutationLocally: reorder moves the dragged note to the target position', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const list = [note(), note({ _id: 'note-2' }), note({ _id: 'note-3' })];

  const next = applyMutationLocally(list, { type: 'reorder', sourceId: 'note-3', targetId: 'note-1' });

  assert.deepEqual(next.map(n => n._id), ['note-3', 'note-1', 'note-2']);
});

test('applyMutationLocally: degenerate inputs are tolerated', async () => {
  const { applyMutationLocally } = await import(moduleUrl);
  const existing = [note()];

  assert.strictEqual(applyMutationLocally(existing, null), existing);
  assert.strictEqual(applyMutationLocally(existing, { type: 'unknown' }), existing);
  assert.strictEqual(applyMutationLocally(existing, { type: 'reorder', sourceId: 'x', targetId: 'x' }), existing);
  assert.deepEqual(applyMutationLocally(null, { type: 'delete', id: 'x' }), []);
});

test('mergeIfChanged: identical payloads keep the current reference', async () => {
  const { mergeIfChanged } = await import(moduleUrl);
  const current = {
    notes: [note()],
    pagination: { page: 1, limit: 50, total: 1, pages: 1 },
    counts: { active: 1, archived: 0 },
    tags: [{ name: 'tag', count: 1 }],
  };
  const incoming = {
    notes: [note()],
    pagination: { page: 1, limit: 50, total: 1, pages: 1 },
    counts: { active: 1, archived: 0 },
    tags: [{ name: 'tag', count: 1 }],
  };

  assert.strictEqual(mergeIfChanged(current, incoming), current);
});

test('mergeIfChanged: server-side note changes are detected', async () => {
  const { mergeIfChanged } = await import(moduleUrl);
  const current = {
    notes: [note()],
    pagination: { page: 1, limit: 50, total: 1, pages: 1 },
    counts: { active: 1, archived: 0 },
    tags: [],
  };
  const changedNote = note({ updatedAt: '2026-03-01T10:00:00.000Z' });

  assert.notStrictEqual(mergeIfChanged(current, { ...current, notes: [changedNote] }), current);

  const byPin = mergeIfChanged(current, { ...current, notes: [note({ isPinned: true })] });
  assert.notStrictEqual(byPin, current);

  const byArchive = mergeIfChanged(current, { ...current, notes: [note({ isArchived: true })] });
  assert.notStrictEqual(byArchive, current);

  const byNewNote = mergeIfChanged(current, { ...current, notes: [note(), note({ _id: 'note-2' })] });
  assert.notStrictEqual(byNewNote, current);
});

test('mergeIfChanged: pagination, counts and tag changes are detected', async () => {
  const { mergeIfChanged } = await import(moduleUrl);
  const current = {
    notes: [],
    pagination: { page: 1, limit: 50, total: 0, pages: 0 },
    counts: { active: 0, archived: 0 },
    tags: [],
  };

  assert.notStrictEqual(
    mergeIfChanged(current, { ...current, pagination: { ...current.pagination, total: 7 } }),
    current
  );
  assert.notStrictEqual(
    mergeIfChanged(current, { ...current, counts: { active: 7, archived: 0 } }),
    current
  );
  assert.notStrictEqual(
    mergeIfChanged(current, { ...current, tags: [{ name: 'neu', count: 1 }] }),
    current
  );
  // Umbenannter Tag bei gleicher Anzahl ist ebenfalls eine Änderung
  const tagCurrent = { ...current, tags: [{ name: 'alt', count: 1 }] };
  const renamed = mergeIfChanged(tagCurrent, { ...current, tags: [{ name: 'neu', count: 1 }] });
  assert.notStrictEqual(renamed, tagCurrent);
  assert.equal(renamed.tags[0].name, 'neu');
  const identicalTags = mergeIfChanged(tagCurrent, { ...current, tags: [{ name: 'alt', count: 1 }] });
  assert.strictEqual(identicalTags, tagCurrent);
  // Reihenfolge der Notizen ist eine relevante Änderung (Server-Sortierung)
  const withOrder = {
    notes: [note(), note({ _id: 'note-2' })],
    pagination: { page: 1, limit: 50, total: 2, pages: 1 },
    counts: { active: 2, archived: 0 },
    tags: [],
  };
  const reordered = { ...withOrder, notes: [note({ _id: 'note-2' }), note()] };
  assert.notStrictEqual(mergeIfChanged(withOrder, reordered), withOrder);
});

test('createThrottledAction suppresses repeats inside the window and releases afterwards', async () => {
  const { createThrottledAction } = await import(moduleUrl);
  const calls = [];
  let clock = 1_000_000;
  const throttled = createThrottledAction(
    (value) => calls.push(value),
    { windowMs: 15_000, now: () => clock }
  );

  assert.equal(throttled('a'), true, 'first call executes');
  clock += 1_000;
  assert.equal(throttled('b'), false, 'call one second later is throttled');
  clock += 14_000;
  assert.equal(throttled('c'), true, 'call after the window executes');
  assert.deepEqual(calls, ['a', 'c']);
});

test('createThrottledAction honours a custom window', async () => {
  const { createThrottledAction } = await import(moduleUrl);
  const calls = [];
  let clock = 0;
  const throttled = createThrottledAction(() => calls.push(clock), { windowMs: 60, now: () => clock });

  throttled();
  clock = 59;
  assert.equal(throttled(), false);
  clock = 60;
  assert.equal(throttled(), true);
  assert.equal(calls.length, 2);
});

test('getEmptyStateReason priorisiert wie das ursprüngliche App.jsx', async () => {
  const { getEmptyStateReason } = await import(moduleUrl);

  assert.equal(getEmptyStateReason({ hasNotes: true, selectedTag: 'x', searchTerm: 'y' }), null);
  assert.equal(getEmptyStateReason({ hasNotes: false, selectedTag: null, searchTerm: '' }), 'noNotes');
  assert.equal(getEmptyStateReason({ hasNotes: false, selectedTag: 'werk', searchTerm: '' }), 'noTagResults');
  // Tag schlägt Suche (Reihenfolge der ursprünglichen Bedingungen)
  assert.equal(getEmptyStateReason({ hasNotes: false, selectedTag: 'werk', searchTerm: 'xyz' }), 'noTagResults');
  assert.equal(getEmptyStateReason({ hasNotes: false, selectedTag: null, searchTerm: 'xyz' }), 'noSearchResults');
  assert.equal(getEmptyStateReason(), 'noNotes');
});

// ---------------------------------------------------------------------------
// Statische Absicherung des Core-Refactorings (P13-P17)
// ---------------------------------------------------------------------------

const readClientFile = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

test('toter useNotes-Hook ist entfernt und durch useNotesManager ersetzt', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/hooks/useNotes.js')), false);
  const hooksIndex = readClientFile('src/hooks/index.js');
  assert.doesNotMatch(hooksIndex, /useNotes(?!Manager)/);
  assert.match(hooksIndex, /export \{ useNotesManager \} from '\.\/useNotesManager'/);

  const app = readClientFile('src/App.jsx');
  assert.match(app, /useNotesManager\(\{/);
  // Zeilen wie wc -l zählen (trailing newline nicht als eigene Zeile).
  // Obergrenze 420: App.jsx darf keine Geschäftslogik zurückholen (die lebt in
  // useNotesManager); der Spielraum über 400 kommt aus den Audit-Fixes
  // 2026-09-10 (OAuth-Callback-State gegen das Login-Flackern, Ctrl+N-Guard).
  const lineCount = app.endsWith('\n') ? app.split('\n').length - 1 : app.split('\n').length;
  assert.ok(lineCount < 420, `App.jsx sollte < 420 Zeilen haben, hat aber ${lineCount}`);
});

test('App.jsx nutzt React.lazy + Suspense für AdminConsole, Settings und OAuthCallback', () => {
  const app = readClientFile('src/App.jsx');
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/AdminConsole\.jsx'\)\)/);
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/Settings\.jsx'\)\)/);
  assert.match(app, /React\.lazy\(\(\) => import\('\.\/components\/OAuthCallback\.jsx'\)\)/);
  const suspenseCount = (app.match(/<Suspense/g) || []).length;
  assert.ok(suspenseCount >= 3, `erwartet 3 Suspense-Wrapper, gefunden ${suspenseCount}`);
  assert.doesNotMatch(app, /import AdminConsole from/);
  assert.doesNotMatch(app, /import Settings from/);
  assert.doesNotMatch(app, /import OAuthCallback from/);
});

test('App.jsx rendert Skeleton-Karten beim ersten Laden und dimmt bei Hintergrund-Refresh', () => {
  const app = readClientFile('src/App.jsx');
  // Die presentational Pieces (Skeleton, EmptyState, Sections, Trash-Header)
  // leben in components/AppStates.jsx, damit App.jsx reine Verdrahtung bleibt.
  const states = readClientFile('src/components/AppStates.jsx');
  assert.match(states, /export function NotesSkeleton\(/);
  assert.match(states, /skeleton skeleton-card/);
  assert.match(states, /skeleton skeleton-text/);
  assert.match(app, /import \{ NotesSkeleton, EmptyState, NotesSection, TrashHeader \} from '\.\/components\/AppStates';/);
  assert.match(app, /<NotesSkeleton \/>/);
  assert.match(app, /loading && notes\.length === 0/);
  assert.match(app, /aria-busy=\{refreshing\}/);
  assert.match(app, /opacity: 0\.6/);
  assert.doesNotMatch(app, /loadingNotes/);
});

test('401-Session-Expiry: apiUtils feuert gedrosseltes Event, AuthContext reagiert', () => {
  const apiUtils = readClientFile('src/services/api/apiUtils.js');
  assert.match(apiUtils, /export const UNAUTHORIZED_EVENT = 'keeplocal:unauthorized'/);
  assert.match(apiUtils, /new CustomEvent\(UNAUTHORIZED_EVENT, \{ detail: \{ endpoint \} \}\)/);
  assert.match(apiUtils, /UNAUTHORIZED_EVENT_THROTTLE_MS = 30000/);
  assert.match(apiUtils, /lastUnauthorizedEventAt/);
  assert.doesNotMatch(apiUtils, /window\.location\.href/);

  const context = readClientFile('src/contexts/AuthContext.jsx');
  assert.match(context, /window\.addEventListener\(UNAUTHORIZED_EVENT, handleUnauthorized\)/);
  assert.match(context, /setSessionExpired\(true\)/);
  assert.match(context, /sessionExpired,/);

  const app = readClientFile('src/App.jsx');
  assert.match(app, /t\('sessionExpired'\)/);
  assert.doesNotMatch(app, /TODO-STR/);
  for (const catalog of ['de.js', 'en.js']) {
    const translations = readClientFile(`src/translations/${catalog}`);
    assert.match(translations, /sessionExpired:/, `${catalog} must define sessionExpired`);
  }
});

test('HTTP-Fehler tragen Status und Body (409-Durchreichung für NoteModal)', () => {
  const apiUtils = readClientFile('src/services/api/apiUtils.js');
  // Status/Body werden in utils/httpErrors.mjs gesetzt (ausführbar getestet in
  // tests/errorPropagation.test.js); apiUtils delegiert dorthin.
  const httpErrors = readClientFile('src/utils/httpErrors.mjs');
  assert.match(httpErrors, /error\.status = status/);
  assert.match(httpErrors, /error\.data = payload/);
  assert.match(apiUtils, /buildHttpError\(\{ status, payload \}\)/);

  const hook = readClientFile('src/hooks/useNotesManager.js');
  assert.match(hook, /error\.status === 409/);
  assert.match(hook, /throw error;/);
});

test('Live-Refresh: Focus/visibility-Throttle und 60s-Poll mit sauberem Cleanup', () => {
  const hook = readClientFile('src/hooks/useNotesManager.js');
  assert.match(hook, /FOCUS_REFRESH_THROTTLE_MS = 15_000/);
  assert.match(hook, /POLL_INTERVAL_MS = 60_000/);
  assert.match(hook, /window\.addEventListener\('focus', onWake\)/);
  assert.match(hook, /document\.addEventListener\('visibilitychange', onWake\)/);
  assert.match(hook, /visibilityState !== 'visible'\) return/);
  assert.match(hook, /clearInterval\(pollInterval\)/);
  assert.match(hook, /window\.removeEventListener\('focus', onWake\)/);
});

test('Lokale Mutationen statt Full-Refetch: Sequenzschutz und Hintergrund-Revalidation', () => {
  const hook = readClientFile('src/hooks/useNotesManager.js');
  assert.match(hook, /applyMutationLocally/);
  assert.match(hook, /invalidateInFlightFetches/);
  assert.match(hook, /background: true/);
  assert.match(hook, /setRefreshing\(true\)/);
  assert.match(hook, /mergeIfChanged/);
});

test('Build-Konfiguration: vendor-react Chunk, keine browserslist, latin-only Delius-Font', () => {
  const viteConfig = readClientFile('vite.config.mjs');
  assert.match(viteConfig, /manualChunks\(id\)\s*\{/);
  assert.match(viteConfig, /return 'vendor-react'/);
  assert.match(viteConfig, /\(react\|react-dom\|scheduler\)/);

  const pkg = JSON.parse(readClientFile('package.json'));
  assert.equal(pkg.browserslist, undefined);

  const entry = readClientFile('src/index.jsx');
  assert.match(entry, /@fontsource\/delius-swash-caps\/latin\.css/);
  assert.doesNotMatch(entry, /import '@fontsource\/delius-swash-caps';/);
});
