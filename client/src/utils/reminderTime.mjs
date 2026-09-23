/**
 * Erinnerungs-Konverter (v1.17.1, Review-Fund der v1.17.0-Runde).
 *
 * datetime-local will 'YYYY-MM-DDTHH:mm' in der Lokalzeit; remindAt reist
 * als ISO-UTC. Zwei Fallstricke, die die alte Inline-Version in
 * NoteModal.jsx hatte:
 *   1. Teil-Eingaben ('2026-03-05T14' mitten im Tippen) parsten zu NaN →
 *      null → beim Speichern wurde die BESTEHende Erinnerung still gelöscht.
 *   2. Datums-only ('2026-03-05') parste als UTC-Mitternacht — die
 *      Erinnerung klingelte je nach Zeitzone Stunden zu früh/spät.
 *
 * Als .mjs extrahiert, weil der Client-Testrunner (node --test) JSX nicht
 * lädt — reine Funktionen gehören in utils (wie storageFormat.mjs).
 */

/** ISO-UTC → 'YYYY-MM-DDTHH:mm' in der Lokalzeit; kaputt/leer → ''. */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Editor-Eingabe → ISO-UTC.
 * @returns {string|null|undefined}
 *   string     gültige Eingabe (Datum oder Datum+Zeit, LOKAL interpretiert)
 *   null       leeres Feld — Erinnerung ausdrücklich löschen
 *   undefined  unvollständige/ungültige Eingabe — Erinnerung UNVERÄNDERT
 *              lassen (kein stiller Verlust beim Save mitten im Tippen)
 */
export function localInputToIso(value) {
  if (value === '' || value === null || value === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value).trim());
  if (!match) return undefined;
  const [, year, month, day, hour = '00', minute = '00'] = match;
  // new Date('2026-03-05') wäre UTC — explizit lokal bauen (Fallstrick 2).
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
