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
  // Obergrenze 520: App.jsx darf keine Geschäftslogik zurückholen (die lebt in
  // useNotesManager); der Spielraum über 400 kommt aus den Audit-Fixes
  // 2026-09-10 (OAuth-Callback-State, Ctrl+N-Guard) und Nr. 26 (2026-09-13:
  // stabile Handler per useCallback, listActions in useMemo, Suspense-Wrapper
  // für die drei lazy Modals — Verdrahtung, keine Logik). v1.10.0 (2026-09-19)
  // erhöht erneut: Sidebar-/Modal-/BulkBar-Props für Baum, Journal und
  // gespeicherte Suchen — die zugehörige Logik steckt in useFolderFeatures.
  const lineCount = app.endsWith('\n') ? app.split('\n').length - 1 : app.split('\n').length;
  assert.ok(lineCount < 520, `App.jsx sollte < 520 Zeilen haben, hat aber ${lineCount}`);
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

// ---------------------------------------------------------------------------
// Nr. 26 (Top-30, 2026-09-13): Die Notizliste renderte bei jedem 60-s-Poll und
// jedem Tab-Fokus komplett neu — sichtbares Dimmen auf 60 %, 50× DOMPurify im
// Leerlauf, operationLoading wuchs über die Session. Diese Tests pinnen die
// Gegenmaßnahmen: memoisierte Karten, stabile Handler/listActions, verzögertes
// Dimmen, Einträge werden entfernt statt auf false gesetzt, Modals lazy.
// ---------------------------------------------------------------------------

const hookUrl = () => import(pathToFileURL(path.join(__dirname, '..', 'src/hooks/useNotesManager.js')).href);

test('shouldDimRefresh: schnell oder ohne Ergebnis wird nie gedimmt', async () => {
  const { shouldDimRefresh, REFRESH_DIM_DELAY_MS } = await hookUrl();

  assert.equal(REFRESH_DIM_DELAY_MS, 250, 'Delay bleibt Teil des Verhaltensvertrags');
  // Der Idle-Poll auf einem schnellen Self-Host antwortet in <250 ms —
  // genau der Fall, der die Liste vorher zweimal pro Minute pulsieren ließ.
  assert.equal(shouldDimRefresh(30, true), false, 'schneller Refresh mit Ergebnis dimmt nicht');
  assert.equal(shouldDimRefresh(249, true), false, 'knapp unter der Schwelle dimmt nicht');
  assert.equal(shouldDimRefresh(2000, false), false, 'ein Langläufer ohne Ergebnis dimmt nicht');
  assert.equal(shouldDimRefresh(250, true), true, 'spürbar lang UND mit Ergebnis dimmt');
  assert.equal(shouldDimRefresh(4000, true), true, 'sehr lang mit Ergebnis dimmt');
  assert.equal(shouldDimRefresh(4000, true, 1000), true, 'delayMs übersteuern senkt die Schwelle');
  assert.equal(shouldDimRefresh(4000, true, 10000), false, 'delayMs übersteuern hebt die Schwelle');
});

test('withoutOperation: Einträge werden entfernt, Identität bleibt ohne Arbeit stabil', async () => {
  const { withoutOperation } = await hookUrl();

  const loading = { abc: 'pin', def: false, trash: true };
  const next = withoutOperation(loading, 'abc');
  assert.equal('abc' in next, false, 'der erledigte Eintrag ist weg');
  assert.equal(next.def, false);
  assert.equal(next.trash, true);
  assert.notEqual(next, loading, 'bei einer Entfernung MUSS ein neues Objekt entstehen');

  // Der Rückkehr-Fall: ein zweites Cleanup desselben Schlüssels (finally nach
  // frühem Return) darf keine neue Identität erzeugen — sonst invalidiert es
  // die memoisierten Karten doch wieder.
  assert.equal(withoutOperation(next, 'abc'), next, 'no-op Cleanup hält die Referenz');
  assert.equal(withoutOperation(next, 'never-existed'), next);
});

test('Nr. 26: Karte und Liste sind memoisiert, HTML nur noch aus useMemo', () => {
  const note = readClientFile('src/components/Note.jsx');
  assert.match(note, /export default React\.memo\(Note\)/);
  // v1.13.0: sanitizeAndLinkify bleibt im useMemo (plainHtml); das Markdown-
  // HTML kommt async aus useMarkdownHtml und geht nur davor, wenn es schon da
  // ist — sonst flackert rohes Markdown, bis marked geladen ist.
  assert.match(note, /const plainHtml = useMemo\(/);
  assert.match(note, /const contentHtml = markdownHtml \?\? plainHtml;/);
  assert.match(note, /dangerouslySetInnerHTML=\{\{ __html: contentHtml \}\}/);
  assert.doesNotMatch(note, /dangerouslySetInnerHTML=\{\{ __html: sanitizeAndLinkify\(/);

  const noteList = readClientFile('src/components/NoteList.jsx');
  assert.match(noteList, /export default React\.memo\(NoteList\)/);

  const states = readClientFile('src/components/AppStates.jsx');
  assert.match(states, /export const NotesSection = React\.memo\(function NotesSection/);
});

test('Nr. 26: App.jsx liefert stabile Handler und listActions, Modals sind lazy', () => {
  const app = readClientFile('src/App.jsx');

  // Ohne stabile Identitäten läuft React.memo ins Leere.
  assert.match(app, /const openNoteModal = useCallback\(/);
  assert.match(app, /const openCollaborateModal = useCallback\(/);
  assert.match(app, /const handleTagSelect = useCallback\(/);
  assert.match(app, /const selectView = useCallback\(/);
  assert.match(app, /const listActions = useMemo\(\(\) => \(showTrash/);

  // Die drei großen Modals laden erst on demand (NoteModal-CSS war mit 33 kB
  // die größte Datei im Initial-Chunk).
  for (const component of ['NoteModal', 'FriendsModal', 'CollaborateModal']) {
    assert.doesNotMatch(app, new RegExp(`import ${component} from`), `${component} darf nicht statisch importiert werden`);
    assert.match(app, new RegExp(`const ${component} = React\\.lazy\\(\\(\\) => import\\('\\./components/${component}\\.jsx'\\)\\)`));
  }
});

test('Nr. 26: refresh dimmt erst nach REFRESH_DIM_DELAY_MS, nicht sofort', () => {
  const manager = readClientFile('src/hooks/useNotesManager.js');

  assert.match(manager, /REFRESH_DIM_DELAY_MS = 250/);
  assert.match(manager, /dimTimerRef\.current = setTimeout\(\(\) => setRefreshing\(true\), REFRESH_DIM_DELAY_MS\)/);
  // Der Timer stirbt mit seinem Request: superseded, abgewürgt, beendet, unmount.
  const clearCount = (manager.match(/clearTimeout\(dimTimerRef\.current\)/g) || []).length;
  assert.ok(clearCount >= 4, `der Dimm-Timer muss an allen vier Lebensende-Räumen gecliert werden, gefunden: ${clearCount}`);
  assert.doesNotMatch(manager, /if \(background\) setRefreshing\(true\)/, 'sofortiges Dimmen ist verboten');
});

test('Nr. 26: operationLoading schreibt keine false-Leichen mehr', () => {
  const manager = readClientFile('src/hooks/useNotesManager.js');
  assert.doesNotMatch(manager, /\.\.\.prev, \[id\]: false \}\)/, 'Einträge werden entfernt, nicht auf false gesetzt');
  assert.doesNotMatch(manager, /\.\.\.prev, (create|trash): false \}\)/);
  const uses = (manager.match(/setOperationLoading\(prev => withoutOperation\(prev, /g) || []).length;
  // v1.10.0: moveNote und runBulkAction kamen dazu (10 statt 8); v1.11.0: manageTag (11).
  assert.ok(uses === 11, `alle elf Cleanup-Stellen nutzen withoutOperation, gefunden: ${uses}`);
});

// ---------------------------------------------------------------------------
// v1.10.0: buildNoteTree — Verschachtelung der flachen Baum-Projektion
// ---------------------------------------------------------------------------

test('buildNoteTree verschachtelt die flache Projektion und hebt Waisen auf', async () => {
  const { buildNoteTree } = await import(moduleUrl);

  const flat = [
    { id: 'a', parentId: null, title: 'Projekte' },
    { id: 'b', parentId: 'a', title: 'KeepLocal' },
    { id: 'c', parentId: 'b', title: 'Roadmap' },
    { id: 'd', parentId: null, title: ' lose Notiz' },
    // Waise: Eltern-ID existiert (noch) nicht in der Projektion
    { id: 'e', parentId: 'weg', title: 'Waise' },
  ];

  const roots = buildNoteTree(flat);
  assert.equal(roots.length, 3, 'a, d und die Waise sind Wurzeln');
  const projekte = roots.find(root => root.node.id === 'a');
  assert.equal(projekte.children.length, 1);
  assert.equal(projekte.children[0].node.id, 'b');
  assert.equal(projekte.children[0].children[0].node.id, 'c');
  assert.ok(roots.some(root => root.node.id === 'e'), 'die Waise wird zur Wurzel');
});

test('buildNoteTree kappt Zyklen und zu tiefe Ketten an der Wurzel', async () => {
  const { buildNoteTree } = await import(moduleUrl);

  // Zyklus A -> B -> A: beide müssen als Wurzeln landen, kein Rekursions-Tod
  const cyclic = [
    { id: 'a', parentId: 'b', title: 'A' },
    { id: 'b', parentId: 'a', title: 'B' },
  ];
  const roots = buildNoteTree(cyclic);
  assert.equal(roots.length, 2, 'beide Zyklus-Knoten sind eigenständige Wurzeln');
  assert.equal(roots[0].children.length, 0);

  // Kette jenseits des Tiefen-Caps (maxDepth 50): der Knoten auf Tiefe 51
  // reißt heraus und wird selbst Wurzel, statt endlos zu nesten.
  const deep = [];
  for (let i = 0; i < 55; i += 1) {
    deep.push({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}`, title: `N${i}` });
  }
  const deepRoots = buildNoteTree(deep);
  // Tiefe 0..49 hängt an der ersten Wurzel, der Rest startet eine eigene.
  assert.ok(deepRoots.length >= 2, 'die Kette wird am Cap durchtrennt');

  assert.deepEqual(buildNoteTree(null), [], 'keine Projektion -> leerer Wald');
});

// ---------------------------------------------------------------------------
// v1.10.1: runPool — Bulk-Aktionen mit begrenzter Parallelität
// ---------------------------------------------------------------------------

test('runPool arbeitet alle Items ab und begrenzt die Parallelität', async () => {
  const { runPool } = await import(moduleUrl);

  let running = 0;
  let peak = 0;
  const worker = async (item) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running -= 1;
    if (item === 'boom') throw new Error('dieser eine Fehler reißt nichts mit');
    return item;
  };

  const items = ['a', 'b', 'boom', 'c', 'd', 'e', 'f', 'g', 'h'];
  const result = await runPool(items, { limit: 3, worker });

  assert.equal(result.done, 8);
  assert.equal(result.failed, 1);
  assert.ok(peak <= 3, `Parallelität darf 3 nicht übersteigen, war ${peak}`);
  assert.ok(peak >= 2, 'wirklich parallel gearbeitet');
});

test('runPool toleriert leere/degenerierte Eingaben', async () => {
  const { runPool } = await import(moduleUrl);
  const worker = async () => { throw new Error('darf nicht aufgerufen werden'); };

  assert.deepEqual(await runPool([], { worker }), { done: 0, failed: 0 });
  assert.deepEqual(await runPool(null, { worker }), { done: 0, failed: 0 });
  assert.deepEqual(await runPool(['a'], {}), { done: 0, failed: 0 });
  assert.deepEqual(await runPool(['a'], { limit: 0, worker: async () => 'ok' }), { done: 1, failed: 0 }, 'limit < 1 fällt auf 1');
});

// ---------------------------------------------------------------------------
// v1.11.0: Tag-Verwaltung — ein Bulk-Endpoint statt Update-Request pro Notiz
// ---------------------------------------------------------------------------

test('manageTag schreibt einen Bulk-Call und räumt operationLoading ab', () => {
  const manager = readClientFile('src/hooks/useNotesManager.js');
  assert.match(manager, /const manageTag = useCallback\(async \(action, from, to\) =>/);
  // Eine Server-Operation für alle Notizen — kein api.update in der Tag-Pflege.
  assert.match(manager, /await api\.tagOperation\(action, from, to\)/);
  assert.match(manager, /withoutOperation\(prev, 'bulk'\)/);
  const api = readClientFile('src/services/api/notesAPI.js');
  assert.match(api, /tagOperation: \(action, from, to\) =>/);
  assert.match(api, /API_ENDPOINTS\.NOTES\.TAGS/);
  const endpoints = readClientFile('src/constants/api.js');
  assert.match(endpoints, /TAGS: '\/api\/notes\/tags'/);
});

test('Sidebar TagRow: Umbenennen/Zusammenführen/Löschen ohne Button-in-Button', () => {
  const sidebar = readClientFile('src/components/Sidebar.jsx');
  assert.match(sidebar, /function TagRow\(\{ tag, tagNames, selected, color, busy, onSelect, onManage, onMobileClose, t \}\)/);
  // Zeile ist ein div mit Geschwister-Buttons (wie FolderRow), kein Button im Button.
  assert.match(sidebar, /className="sidebar-tag-row"/);
  assert.match(sidebar, /run\('rename', renameValue\.trim\(\)\)/);
  assert.match(sidebar, /run\('merge', mergeTarget\)/);
  // Löschen fragt zweimal nach statt eines nativen Confirm-Dialogs.
  assert.match(sidebar, /confirmDelete \? run\('delete'\) : setConfirmDelete\(true\)/);
  // App.jsx verdrahtet den Handler und gibt den Busy-Zustand weiter.
  const app = readClientFile('src/App.jsx');
  assert.match(app, /onTagManage=\{handleTagManage\}/);
  assert.match(app, /const handleTagManage = useCallback/);
});

// ---------------------------------------------------------------------------
// v1.13.0 Nr. 9: Meta-Sonde für den 60s-Poll (Delta-Sync)
// ---------------------------------------------------------------------------

test('notesMetaSignature: Zählungen + maxUpdatedAt als vergleichbarer String', async () => {
  const { notesMetaSignature } = await import(moduleUrl);

  assert.equal(notesMetaSignature(null), 'none');
  assert.equal(notesMetaSignature(undefined), 'none');
  assert.equal(notesMetaSignature('meta'), 'none');
  // Fehlende Felder fallen auf 0/'' zurück, nicht auf undefined.
  assert.equal(notesMetaSignature({}), '0/0/0/');

  const base = { active: 3, archived: 1, trash: 0, maxUpdatedAt: '2026-01-01T00:00:00.000Z' };
  const signature = notesMetaSignature(base);
  assert.equal(signature, '3/1/0/2026-01-01T00:00:00.000Z');
  assert.equal(notesMetaSignature({ ...base }), signature, 'identische Werte → identische Signatur');

  // Jede serverseitige Änderung allein reißt die Signatur auf: eine neue
  // Notiz (active), ein Löschvorgang (trash), eine Bearbeitung (maxUpdatedAt)
  // und ein Import mit zurückdatierten Zeitstempeln (Zählungen statt
  // maxUpdatedAt, weil importMarkdownNotes alte createdAt/updatedAt setzt).
  assert.notEqual(notesMetaSignature({ ...base, active: 4 }), signature);
  assert.notEqual(notesMetaSignature({ ...base, archived: 2 }), signature);
  assert.notEqual(notesMetaSignature({ ...base, trash: 1 }), signature);
  assert.notEqual(
    notesMetaSignature({ ...base, maxUpdatedAt: '2026-02-01T00:00:00.000Z' }),
    signature
  );
});

test('60s-Poll: Meta-Sonde gatet den Voll-Abruf, fail-open bei Fehler', () => {
  const source = readClientFile('src/hooks/useNotesManager.js');

  // Die Sonde läuft nur, wenn das API sie kennt und der erste Load durch ist —
  // der Initial-Load darf niemals gegatet werden.
  assert.match(source, /typeof api\.getMeta === 'function' && hasLoadedRef\.current/);
  // Identische Signatur beendet den Tick VOR Liste+Baum-Refresh …
  assert.match(source, /if \(metaSignatureRef\.current === signature\) return;/);
  // … und ein Fehler der Sonde lädt trotzdem voll weiter (fail-open), statt
  // den Poll still verhungern zu lassen. (Der Slice beginnt am Gate und endet
  // am ERSTEN refreshInBackground danach — die Focus-Antwort ruft dieselbe
  // Zeile schon vor dem Gate auf.)
  const gateStart = source.indexOf('typeof api.getMeta');
  const gate = source.slice(gateStart, source.indexOf('refreshInBackground', gateStart));
  assert.match(gate, /catch \(_error\) \{/);
  // Beim Logout wird die Signatur zurückgesetzt, damit der nächste Login
  // nicht mit der Signatur der alten Session vergleicht.
  assert.match(source, /metaSignatureRef\.current = null/);
});

test('getMeta und importMarkdownZip sind im notesAPI verdrahtet', () => {
  const api = readClientFile('src/services/api/notesAPI.js');
  assert.match(api, /getMeta: \(options = \{\}\) =>/);
  assert.match(api, /API_ENDPOINTS\.NOTES\.META/);
  assert.match(api, /importMarkdownZip: \(archive\) =>/);
  const endpoints = readClientFile('src/constants/api.js');
  assert.match(endpoints, /META: '\/api\/notes\/meta'/);
  assert.match(endpoints, /IMPORT_MARKDOWN_ZIP: '\/api\/notes\/import\/markdown-zip'/);
  assert.match(endpoints, /BACKUPS: '\/api\/admin\/backups'/);
});
