/**
 * Meta-Signatur-Gate des 60s-Polls (v1.17.1, aus useNotesManager extrahiert).
 *
 * Die v1.17.0-Fehlerklasse, die dieses Modell testbar macht: Der Poll committet
 * Signatur und Cursor einer Sonde ERST, nachdem der Daten-Abruf erfolgreich
 * war. Schlug der (stille) Fetch an einem Blip fehl und stand die Signatur
 * trotzdem schon als „gesehen“ da, sprang der nächste Tick bei unveränderter
 * Signatur ab — die Änderung erreichte den sichtbaren Tab nie wieder.
 *
 * Der Hook bewahrt das Gate in einem Ref (überlebt Renders); hier als reine
 * Fabrik, weil der Client-Testrunner (node --test) kein React lädt.
 *
 * @returns {{seen: (signature: string) => boolean, commit: (signature: string) => void, reset: () => void}}
 */
export function createPollGate() {
  let committed = null;
  return {
    /** Liefert true, wenn diese Signatur schon durch einen ERFOLGREICHEN
     *  Abruf abgedeckt ist — der Aufrufer darf den Tick abkürzen. */
    seen(signature) {
      return committed === signature;
    },
    /** Nach erfolgreichem Daten-Abruf aufrufen — NIEMALS vorher. */
    commit(signature) {
      committed = signature;
    },
    /** Logout/Account-Wechsel: beim nächsten Tick wieder voll laden. */
    reset() {
      committed = null;
    }
  };
}
