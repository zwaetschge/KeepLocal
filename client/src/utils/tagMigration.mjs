// v1.16.0: Reine Mitnahme-Logik für Tag-Rename/Merge/Delete — Tag-Farben und
// gespeicherte Suchen, die auf den alten Namen zeigen, wandern mit. Muss im
// Client laufen (direkt nach dem Server-Lauf): Der SettingsContext pusht die
// lokalen Preferences debounced zurück und würde eine serverseitige Migration
// sofort überschreiben. Eigenes .mjs-Modul ohne API-Importe, damit
// node --test die Logik direkt laden kann (wie notesPayload.mjs).

/**
 * @param {'rename'|'merge'|'delete'} action
 * @param {string[]} from - betroffene alte Tag-Namen
 * @param {?string} to - Zielname (bei delete null)
 * @param {{tagColors?: Object, savedSearches?: Array}} references
 * @returns {?{tagColors: ?Object, savedSearches: ?Array}} null, wenn nichts
 *   betroffen ist — der Handler lostritt dann keine sinnvollen Settings-Pushes.
 */
export function migrateTagReferences(action, from, to, { tagColors = {}, savedSearches = [] } = {}) {
  const affected = from.map((tag) => tag.toLowerCase());
  const matchesTag = (tag) => Boolean(tag) && affected.includes(tag.toLowerCase());

  // Farben: gelöschte Tags verlieren ihren Eintrag; bei Rename/Merge springt
  // die Farbe mit (bereits vorhandene Zielfarbe gewinnt, erste Quelle reicht).
  const matchedKeys = Object.keys(tagColors).filter((name) => matchesTag(name));
  let colors = null;
  if (matchedKeys.length > 0) {
    colors = { ...tagColors };
    if (action !== 'delete' && to && colors[to] === undefined) {
      const donor = matchedKeys.find((name) => colors[name] !== undefined);
      if (donor !== undefined) colors[to] = colors[donor];
    }
    matchedKeys.forEach((name) => { if (name !== to) delete colors[name]; });
  }

  // Gespeicherte Suchen: auf einen gelöschten Tag fällt die Suche weg, sonst
  // zeigt sie ab jetzt auf den neuen Namen.
  let searches = null;
  if (savedSearches.some((search) => matchesTag(search.tag))) {
    searches = action === 'delete'
      ? savedSearches.filter((search) => !matchesTag(search.tag))
      : savedSearches.map((search) => (matchesTag(search.tag) ? { ...search, tag: to } : search));
  }

  if (colors === null && searches === null) return null;
  return { tagColors: colors, savedSearches: searches };
}
