const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// v1.17.0-Runde (Web): W3 Erinnerungen (Editor-Feld, Karten-Chip, Sidebar-
// Übersicht), W4 Quota-Anzeige in den Einstellungen, W5 Badge für offene
// Freundschaftsanfragen. Die Formatierer laufen als echte Funktionen, das
// Verdrahtete als Source-Pins — genauso wie die übrigen UI-Tests des Clients.

const readClientFile = (...parts) =>
  fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const storageFormatUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/storageFormat.mjs')
).href;

// ---------------------------------------------------------------------------
// W4 — formatStorageBytes / storagePercent (rein, für die Quota-Anzeige)
// ---------------------------------------------------------------------------

test('formatStorageBytes: Binärpräfixe, eine Nachkommastelle, robust gegen Müll', async () => {
  const { formatStorageBytes } = await import(storageFormatUrl);

  assert.equal(formatStorageBytes(0), '0 B');
  assert.equal(formatStorageBytes(512), '512 B');
  assert.equal(formatStorageBytes(1024), '1 KB');
  assert.equal(formatStorageBytes(43 * 1024 + 512), '43.5 KB');
  assert.equal(formatStorageBytes(3.14 * 1024 * 1024 * 1024), '3.1 GB');
  // Ab 100 Einheiten reicht die Ganzzahl — „1.023,9 GB“ wäre Geschwätz.
  assert.equal(formatStorageBytes(500 * 1024 * 1024), '500 MB');
  assert.equal(formatStorageBytes(2 * 1024 ** 4), '2 TB');
  // TB ist das Ende der Leiter — Petabytes laufen nicht über.
  assert.equal(formatStorageBytes(7 * 1024 ** 5), '7168 TB');

  assert.equal(formatStorageBytes(null), '0 B', 'null ist kein Speicher');
  assert.equal(formatStorageBytes('x'), '0 B');
  assert.equal(formatStorageBytes(-5), '0 B', 'negativ gibt es nicht');
});

test('storagePercent: geklemmt auf [0, 100], unlimitiert ist null', async () => {
  const { storagePercent } = await import(storageFormatUrl);

  assert.equal(storagePercent(0, 100), 0);
  assert.equal(storagePercent(25, 100), 25);
  assert.equal(storagePercent(150, 100), 100, 'über 100 % bleibt 100 (Balken)');
  assert.equal(storagePercent(-10, 100), 0);
  // limit=0 ist der Server-Wert für „unlimitiert“ (UPLOAD_QUOTA_MB=0) —
  // kein Balken, nur die Nutzungs-Zahl.
  assert.equal(storagePercent(1234, 0), null);
  assert.equal(storagePercent('x', 100), null);
});

// ---------------------------------------------------------------------------
// W4 — Verdrahtung: Endpoint, API-Methode, Settings-Sektion
// ---------------------------------------------------------------------------

test('GET /api/auth/storage ist als Endpoint + API-Methode verdrahtet', () => {
  const constants = readClientFile('src/constants/api.js');
  assert.match(constants, /STORAGE: '\/api\/auth\/storage'/);

  const authApi = readClientFile('src/services/api/authAPI.js');
  assert.match(authApi, /getStorageUsage: async \(\) => fetchWithAuth\(API_ENDPOINTS\.AUTH\.STORAGE\)/);
});

test('Settings laden die Nutzung einmalig und zeigen einen Balken nur bei erzwungener Quota', () => {
  const settings = readClientFile('src/components/Settings.jsx');
  assert.match(settings, /authAPI\.getStorageUsage\(\)/);
  assert.match(settings, /storage\.enforced && \(/, 'ohne enforced keinen Balken (unlimitiert)');
  assert.match(settings, /aria-valuenow=\{storagePercent\(storage\.usedBytes, storage\.limitBytes\) \?\? 0\}/);
  assert.match(settings, /near-limit/, 'ab 90 % wechselt der Balken auf Warnfarbe');
});

// ---------------------------------------------------------------------------
// W3 — Erinnerungen: Editor-Feld, Karten-Chip, Sidebar-Übersicht
// ---------------------------------------------------------------------------

test('NoteModal: datetime-local-Feld, ISO-Konverter, remindAt reist in jedem canManage-Save', () => {
  const modal = readClientFile('src/components/NoteModal.jsx');
  // v1.17.1: Die Konverter leben in utils/reminderTime.mjs (behavioral
  // getestet, s. unten) — hier bleibt der Verdrahtungs-Pin.
  assert.match(modal, /import \{ isoToLocalInput, localInputToIso \} from '\.\.\/utils\/reminderTime\.mjs';/);
  assert.match(modal, /const \[remindAt, setRemindAt\] = useState\(isoToLocalInput\(note\?\.remindAt\)\);/);
  // Externe Aktualisierung (60s-Poll) übernimmt auch die Erinnerung …
  assert.match(modal, /setRemindAt\(isoToLocalInput\(source\.remindAt\)\);/);
  // … und der Save-Wert hängt im canManage-Zweig neben parentId. undefined
  // (unvollständige Eingabe) lässt die gespeicherte Erinnerung in Ruhe.
  assert.match(modal, /const remindAtIso = localInputToIso\(remindAt\);/);
  assert.match(modal, /if \(remindAtIso !== undefined\) noteData\.remindAt = remindAtIso;/);
  assert.match(modal, /type="datetime-local"/);
  assert.match(modal, /note-modal-reminder-clear/, 'ein gesetzter Wert ist löschbar');
});

test('Note-Karte zeigt eine getragene Erinnerung als Chip', () => {
  const note = readClientFile('src/components/Note.jsx');
  assert.match(note, /note\.remindAt && \(/);
  assert.match(note, /note-reminder-chip/);
  assert.match(note, /reminderAt', \{ date: formatReminderDate\(note\.remindAt\) \}\)/);
});

test('Sidebar: anstehende Erinnerungen als Liste, Klick öffnet die Notiz', () => {
  const sidebar = readClientFile('src/components/Sidebar.jsx');
  assert.match(sidebar, /pendingFriendRequests = 0,/);
  assert.match(sidebar, /upcomingReminders = \[\],/);
  assert.match(sidebar, /upcomingReminders\.length > 0 && onOpenReminder && \(/);
  assert.match(sidebar, /onOpenReminder\(reminder\.id\)/);
});

test('upcomingReminders entstehen aus der Baum-Projektion (kompletter Bestand, Top 5)', () => {
  const features = readClientFile('src/hooks/useFolderFeatures.js');
  assert.match(features, /node\.remindAt && !node\.isArchived/);
  assert.match(features, /\.slice\(0, 5\)/);
  // Archiv raus, gefeuerte 60 s drin lassen — sonst verschwindet ein kurz
  // vorbei geplanter Termin sofort.
  assert.match(features, /> Date\.now\(\) - 60_000/);
});

test('App.jsx reicht Badge-Zähler, Erinnerungen und Öffnen-Handler durch', () => {
  const app = readClientFile('src/App.jsx');
  assert.match(app, /pendingFriendRequests=\{pendingFriendRequests\}/);
  assert.match(app, /upcomingReminders=\{upcomingReminders\}/);
  assert.match(app, /onOpenReminder=\{handleOpenNoteById\}/);
});

// ---------------------------------------------------------------------------
// W5 — Badge für offene Freundschaftsanfragen
// ---------------------------------------------------------------------------

test('useNotesManager: Sonde füllt pendingFriendRequests, Logout resettet', () => {
  const hook = readClientFile('src/hooks/useNotesManager.js');
  // Der Zähler reist mit JEDEM Sonden-Ergebnis — auch bei unveränderter
  // Signatur (gleicher Wert → React bail-out).
  assert.match(hook, /if \(Number\.isFinite\(meta\.pendingFriendRequests\)\) \{\s*\n\s*setPendingFriendRequests\(meta\.pendingFriendRequests\);/);
  assert.match(hook, /setPendingFriendRequests\(0\);/, 'Logout bringt den Badge auf null');
  assert.match(hook, /pendingFriendRequests,/);
});

test('Sidebar zeigt den Badge nur bei Zähler > 0 — Klasse pending-friends-badge', () => {
  const sidebar = readClientFile('src/components/Sidebar.jsx');
  assert.match(sidebar, /pendingFriendRequests > 0 && \(/);
  assert.match(sidebar, /pending-friends-badge/);
});

// ---------------------------------------------------------------------------
// i18n — beide Sprachen tragen alle neuen Schlüssel
// ---------------------------------------------------------------------------

test('Erinnerungs-/Speicher-/Badge-Schlüssel existieren in de UND en', async () => {
  // Dynamischer Import: Die Übersetzungen sind ES-Module.
  const de = await import(pathToFileURL(path.join(__dirname, '../src/translations/de.js')).href).then(m => m.de);
  const en = await import(pathToFileURL(path.join(__dirname, '../src/translations/en.js')).href).then(m => m.en);
  for (const key of [
    'reminderLabel', 'reminderClear', 'reminderAt',
    'upcomingReminders', 'pendingFriendRequests',
    'storageSection', 'storageUsed', 'storageLimitHint', 'storageNearLimit'
  ]) {
    assert.equal(typeof de[key], 'string', `de.${key} fehlt`);
    assert.equal(typeof en[key], 'string', `en.${key} fehlt`);
    assert.notEqual(de[key], '', `${key} ist leer (de)`);
  }
  assert.match(de.reminderAt, /\{date\}/, 'Platzhalter muss zur Interpolation passen');
  assert.match(en.reminderAt, /\{date\}/);
});

// ---------------------------------------------------------------------------
// v1.17.1 — Review-Fixes: Erinnerungs-Konverter + Poll-Gate (behavioral)
// ---------------------------------------------------------------------------

test('localInputToIso: Teil-Eingabe lässt die Erinnerung unverändert (undefined)', async () => {
  const { localInputToIso } = await import(pathToFileURL(
    path.join(__dirname, '../src/utils/reminderTime.mjs')).href);

  // Der v1.17.0-Bug: mitten im Tippen gespeichert → NaN → null → die
  // bestehende Erinnerung war still GELÖSCHT.
  assert.equal(localInputToIso('2026-03-05T14'), undefined, 'Teil-Eingabe');
  assert.equal(localInputToIso('2026-03'), undefined);
  assert.equal(localInputToIso('garbage'), undefined);
  // Leeres Feld bleibt die ausdrückliche Löschung.
  assert.equal(localInputToIso(''), null);
  assert.equal(localInputToIso(null), null);
  assert.equal(localInputToIso(undefined), null);
});

test('localInputToIso interpretiert Datum und Datum+Zeit als LOKAL, nie UTC', async () => {
  const { localInputToIso } = await import(pathToFileURL(
    path.join(__dirname, '../src/utils/reminderTime.mjs')).href);

  const iso = localInputToIso('2026-03-05T14:30');
  assert.ok(typeof iso === 'string' && iso.endsWith('Z'));
  // Roundtrip zurück in die Lokalzeit muss dieselben Felder zeigen —
  // new Date('2026-03-05') (UTC-Parsing) würde das je nach Zeitzone brechen.
  const back = new Date(iso);
  assert.equal(back.getFullYear(), 2026);
  assert.equal(back.getMonth(), 2);
  assert.equal(back.getDate(), 5);
  assert.equal(back.getHours(), 14);
  assert.equal(back.getMinutes(), 30);

  const dateOnly = localInputToIso('2026-03-05');
  assert.ok(typeof dateOnly === 'string', 'Datum-only gilt als lokale Mitternacht');
  const midnight = new Date(dateOnly);
  assert.equal(midnight.getHours(), 0);
  assert.equal(midnight.getDate(), 5);
});

test('pollGate: Signatur zählt erst nach erfolgreichem Abruf als gesehen', async () => {
  const { createPollGate } = await import(pathToFileURL(
    path.join(__dirname, '../src/utils/pollGate.mjs')).href);

  const gate = createPollGate();
  const signature = '12/0/3/2026-09-23T10:00:00.000Z';
  // Negative sequence des v1.17.0-Fixes: Fetch schlägt fehl → KEIN commit →
  // der nächste Tick mit derselben Signatur muss erneut laden.
  assert.equal(gate.seen(signature), false, 'nie committet = nie gesehen');
  gate.commit(signature);
  assert.equal(gate.seen(signature), true, 'nach Erfolg gilt: gesehen');
  assert.equal(gate.seen('andere'), false);
  // Logout: alles vergessen, der nächste Login lädt voll.
  gate.reset();
  assert.equal(gate.seen(signature), false, 'nach reset ist nichts gesehen');
});
