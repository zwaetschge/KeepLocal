// v1.16.0: Best-effort-Purge der Service-Worker-Caches beim Logout.
//
// Der Worker cached /api/notes-Antworten (SWR) — nach einem Logout auf einem
// geteilten Gerät blieben die Notizen des Vorgängers im Cache-Speicher
// lesbar, bis der nächste Login sie überschrieb. Der Worker selbst purgt nur
// auf 401-eines GETs (der neue Account sieht andere Daten), deshalb hier der
// explizite Schlag bei logout(). Die Funktion ist absichtlich als eigenes
// .mjs ohne API-Importe gehalten (wie tagMigration.mjs): node --test kann
// die Logik mit einem gefakten caches-Objekt direkt prüfen.

/**
 * Löscht alle Caches deren Name mit 'keeplocal-' beginnt (der Worker
 * versioniert: keeplocal-v8, keeplocal-v9, …) und liefert die Anzahl der
 * gelöschten Caches.
 *
 * @param {{keys?: () => Promise<string[]>, delete?: (name: string) => Promise<boolean>}} [cachesApi]
 *   Überschreibbar für Tests; default das globale `caches`.
 * @returns {Promise<number>} Anzahl gelöschter Caches — 0 auch, wenn die
 *   Cache-API fehlt (insecure context, alte Browser): Logout darf daran
 *   nie scheitern.
 */
export async function purgeAppCaches(cachesApi = globalThis.caches) {
  if (!cachesApi || typeof cachesApi.keys !== 'function') return 0;
  try {
    const names = await cachesApi.keys();
    const ours = names.filter((name) => name.startsWith('keeplocal-'));
    await Promise.all(
      ours.map((name) => (typeof cachesApi.delete === 'function' ? cachesApi.delete(name) : Promise.resolve(false)))
    );
    return ours.length;
  } catch {
    // Best effort: ein fehlgeschlagener Purge blockiert den Logout nicht.
    return 0;
  }
}
