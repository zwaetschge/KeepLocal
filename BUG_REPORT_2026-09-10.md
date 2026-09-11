# KeepLocal Bug Report — 2026-09-10 (Folgerunde nach dem Fix-Sprint)

> **Fix-Status (Update 2026-09-10, gleiche Sitzung):** Alle Funde **1–15 und 17–19 sind behoben**,
> inklusive aller drei HIGH-Funde. **Nr. 16 (Drag&Drop-Ordnung) bleibt bewusst offen** — sie braucht
> ein persistiertes Order-Feld plus API (Produktentscheidung, wie schon in Nr. 14 des Vorberichts).
> Verifikation: Server **89/89** (+10 neue Tests), Client **121/121** (+14 neue Tests), ESLint clean,
> `vite build` clean, 3× `docker compose config` OK, `bash -n entrypoint.sh` OK, nginx-Header erneut
> gegen einen real geladenen nginx geprüft, und **derselbe Puppeteer/Chromium-Parcours noch einmal
> gegen den frischen Produktions-Build und den Dev-Server gefahren: 20/21 Checks PASS** (der eine
> „FAIL“ war ein Messfehler im Skript — zwei gleich lautende Toasts wurden als ein Text gezählt;
> die Nachmessung mit unterschiedlichen Meldungen zeigt 2 gleichzeitige Toasts mit je ~2,9 s Lebensdauer).
> Details je Fund: Tabelle „Behoben-Status“ am Ende.

Base: Branch `agent/refresh-stale-files`, Commit `c8b4e58` + **unveröffentlichter Working Tree**
(alle Fixes aus `BUG_REPORT_2026-08-15.md`, Stand 2026-08-17).

Methode: keine reine Code-Lektüre dieses Mal, sondern **laufender Stack + echter Browser**:

- MongoDB 8 aus dem All-in-One-Image (`docker run … mongod`, Port 27099), Server aus dem Working Tree
  (`node server.js`, NODE_ENV=development), Vite-Dev-Server (3000/3210) **und** Produktions-Build
  (`vite build` → eigener Static+Proxy-Server auf 4100/4101), gesteuert mit Puppeteer/Chromium
  (1440×900 und 390×844, `Accept-Language: en-US`).
- nginx-Konfiguration real geladen: `docker run --entrypoint nginx -v client/nginx.conf:…` und
  `curl -I` gegen `location /`, `/app.js`, `/guard.js`.
- API-Sonden direkt gegen den Server (Login + CSRF + POST/PUT-Matrizen), YAML-Bisect gegen das
  installierte `yaml`-Paket für den Swagger-Fund.
- Vorhandene Suiten beim Start: **Server 79/79, Client 107/107, ESLint clean, `vite build` clean,
  `docker compose config` für alle drei Varianten OK, `bash -n entrypoint.sh` OK.** Alle Funde unten
  liegen also in Pfaden, die keine Testabdeckung haben.
- Scratch-Kopien lagen unter `/tmp` (u. a. eine um **eine Zeile** gepatchte Client-Kopie, um nach dem
  Crash-Fund Nr. 1 überhaupt weiter testen zu können). **Am Repository wurde nichts verändert.**

Abgrenzung: Alles, was `BUG_REPORT_2026-08-15.md` als behoben listet, wurde stichprobenartig
nachgeprüft und gilt als erledigt (Liste am Ende) — außer den hier explizit genannten unvollständigen
Fixen (Nr. 12 → Fund 11, Nr. 21 → Fund 3, Nr. 33 → Fund 5, Nr. 14 → Fund 16, Nr. 25 → Fund 14).

Beweismittel (Screenshots/DOM-Dumps): `../audit-evidence/*.png` (außerhalb des Git-Repos),
 Roh-Logs unter `/tmp/kl-live/*.log`.

---

## HIGH — Kernfunktion tot / Sicherheitsregression

### 1. Notiz-Editor crasht beim Schließen die ganze App (Produktion), beim Öffnen (Dev)

`client/src/components/NoteModal.jsx:62-68`

```js
useEffect(() => () => {
  if (mediaRecorderRef.current?.state !== 'inactive') {   // null?.state === undefined ≠ 'inactive' → true
    mediaRecorderRef.current.onstop = null;               // TypeError: Cannot set properties of null
    mediaRecorderRef.current.stop();
  }
  …
}, []);
```

`mediaRecorderRef.current` ist `null`, solange niemand aufgenommen hat. `null?.state !== 'inactive'`
ist `true`, danach wird dereferenziert → `TypeError: Cannot set properties of null (setting 'onstop')`
→ ErrorBoundary reißt die komplette App weg (Notizliste, Header, alles).

Reproduziert im **Produktions-Build** (`vite build`, ohne StrictMode-Doppel-Mount):

- Notiz anlegen → „Speichern" → Notiz wird korrekt gespeichert (201), **App stirbt**:
  `Etwas ist schiefgelaufen … Diagnose: KL-066B54B1 · TypeError … Cannot set properties of null (setting 'onstop')`,
  Buttons „App sicher aktualisieren" / „Nur neu laden". (`audit-evidence/80-prod-crash-after-save.png`)
- Ebenso bei „Abbrechen" und bei Escape (leerer Editor) — **jeder** Schließpfad. Deterministisch, 4/4.
- Im **Dev-Server** (`npm run dev`, StrictMode) crasht es bereits beim **Öffnen** des Editors, weil der
  Cleanup einmal sofort läuft: `npm run dev` ist damit für den Hauptfluss unbenutzbar.

Fix (eine Zeile, in der Scratch-Kopie verifiziert — danach liefen alle übrigen Tests durch):

```js
const recorder = mediaRecorderRef.current;
if (recorder && recorder.state !== 'inactive') { recorder.onstop = null; recorder.stop(); }
```

### 2. Notizen mit Link-Vorschau ohne Bild lassen sich überhaupt nicht speichern (400)

`server/middleware/validators.js:106-110` (create) und `:210-214` (update) gegen
`server/utils/linkPreview.js` (liefert `image: ""`) und `client/src/hooks/useLinkPreview.js`.

```js
body('linkPreviews.*.image')
  .optional()          // überspringt nur undefined, NICHT ""
  .trim()
  .isURL()
  .withMessage('Link-Preview Bild muss eine gültige URL sein'),
```

Der serverseitige Preview-Endpunkt gibt für Seiten ohne `og:image` `"image": ""` zurück
(`POST /api/notes/link-preview` → `{"url":"https://example.com/","title":"Example Domain","description":"","image":"","siteName":"example.com"}`).
Der Client schickt exakt dieses Objekt beim Speichern zurück → 400:

```
POST /api/notes → 400
{"error":"Validierungsfehler","details":[{"msg":"Link-Preview Bild muss eine gültige URL sein",
  "path":"linkPreviews[0].image","location":"body"}]}
PUT  /api/notes/:id → 400 (gleiche Regel, d. h. auch bestehende Notizen mit Vorschau sind nicht mehr editierbar)
```

API-Matrix (live, gleicher Cookie/CSRF-Kontext):

| Payload                                  | Ergebnis |
|------------------------------------------|----------|
| `linkPreviews:[{…,image:""}]`            | **400**  |
| `linkPreviews:[{…}]` (image weggelassen) | 201      |
| `linkPreviews:[{…,image:"https://…"}]`   | 201      |
| ohne `linkPreviews`                      | 201      |

Nutzerwirkung: Link einfügen → Vorschau erscheint → „Speichern" → Toast „Validierungsfehler", Modal
bleibt offen, nichts wird gespeichert. `notesService.validateNoteData` (`services/notesService.js:131-141`)
toleriert `image: ""` ausdrücklich (`preview.image && …`) — Validator und Service widersprechen sich.

Fix: `.optional({ checkFalsy: true })` (Muster steht zwei Zeilen darüber bei `body('content')`,
`validators.js:29/133`) bzw. v7-äquivalent `{ values: 'falsy' }`; alternativ `image` im Preview-Response
weglassen, wenn es leer ist. Beides, damit Alt-Daten mit `image: ""` ebenfalls wieder editierbar sind.

### 3. Split-Nginx serviert `index.html` ohne CSP und ohne Clickjacking-Schutz

`client/nginx.conf:102-110` (neuer no-store-Block aus Fix Nr. 21)

Die Security-Header stehen auf `server`-Ebene (`client/nginx.conf:18-22`). nginx vererbt `add_header`
**nur, wenn der Location-Block keine eigenen `add_header` hat**. Der neue Block setzt
`Cache-Control`/`Pragma`/`Expires` und verliert damit CSP, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` — ausgerechnet für das Hauptdokument.

Beweis (nginx 1.18 mit exakt dieser Config, `curl -I`):

```
GET /            → 200 OK  Cache-Control, Pragma, Expires            ← KEINE Security-Header
GET /app.js      → 200/404 Cache-Control + alle 5 Security-Header    (eigener Block deklariert sie neu)
GET /guard.js    → 200/404 Cache-Control + alle 5 Security-Header
```

`nginx-allinone.conf:128-142` macht es richtig (dort stehen alle fünf Header zusätzlich im
`location /`-Block) — die Split-Varianten `docker-compose.yml` und `docker-compose.npm.yml` sind
betroffen, also der empfohlene Mehr-Container-Aufbau. AUDIT_REPORT.md („Added a strict Nginx CSP")
gilt für diesen Pfad nicht mehr; `frame-ancestors`/`X-Frame-Options` fehlen → Login-Seite ist frambar.

Fix: die fünf `add_header … always;`-Zeilen aus `nginx-allinone.conf` in `client/nginx.conf:102-110`
kopieren (und künftig einen `include snippets/security-headers.conf;` verwenden, statt sie 6× zu duplizieren).

---

## MEDIUM

### 4. Toast-System: zweite Meldung verdrängt die erste und wird von deren Timer weggeräumt

`client/src/App.jsx:176-177` (`<Toast …>` ohne `key`), `client/src/components/Toast.jsx:14-20`
(Dismiss-Timer mit Deps `[duration]`), `client/src/components/ToastStack.jsx` (fertige Queue, ungenutzt).

App hält **ein** Toast im State. Eine neue Meldung ersetzt die alte (Meldung 1 ist verloren) und erbt
deren laufenden Timer, weil das Effect nur bei `duration`-Wechsel neu startet. Die Fortschrittsleiste
(`Toast.css` `toastProgress 3s`) läuft ebenfalls nicht neu an.

Gemessen im Produktions-Build (Login → Pin → Pin, 150-ms-Raster):

```
    0ms  „Signed in successfully"
  465ms  „Note unpinned"        ← ersetzt die Login-Meldung
 1076ms  „Note pinned"          ← ersetzt „Note unpinned" nach ~600 ms
 2147ms  (keine Toast mehr)     ← „Note pinned" lebt ~1,1 s statt 3 s
```

Dev-Messung (stage5): „Note unpinned" verschwand nach ~300 ms. Fehler-Toasts können so praktisch
unsichtbar werden, wenn kurz zuvor eine Erfolgsmeldung lief.

Fix: App.jsx publiziert auf `toastBus` (der Stack ist mit `<ToastStack />` in `App.jsx:389` bereits
app-weit gemountet, Queue + `key` + eigene Timer pro Toast sind vorhanden) und der lokale
`toast`-State samt `<Toast>` fliegt raus. Minimalvariante: `<Toast key={toast.id} …/>` + `message`
in die Timer-Deps. Die `TODO (Integrator/B1)`-Notiz in `ToastStack.jsx:14-21` beschreibt genau das —
sie ist nur nicht ausgeführt worden, deshalb laufen jetzt zwei Toast-Systeme parallel.

### 5. NoteModal ohne Backdrop-Guard: Textauswahl + Loslassen auf dem Backdrop speichert/verwirft

`client/src/components/NoteModal.jsx:490-499` (`handleOverlayClick`) und `:530` (`onClick` am Overlay).
Fix Nr. 33 (`hooks/useBackdropClose.js`) ist in Admin/Friends/Collaborate/Settings eingebaut, im
wichtigsten Formular aber nicht.

Live-Reproduktion (echter Maus-Drag: mousedown in der Textarea → mouseup auf dem Backdrop):

- Mit Inhalt: Modal schließt **und speichert** ungefragt.
- **Nur Titel, kein Inhalt** (`hasContent` false → `onClose()`): Modal schließt, Eingabe ist weg —
  getestet: `NurTitelOhneInhalt` war nach dem Drag nicht in der Notizliste (stiller Datenverlust).

Fix: `const backdropClose = useBackdropClose(handleOverlayClick);` und `{...backdropClose}` statt
`onClick={handleOverlayClick}` am Overlay (`.note-modal-overlay`).

### 6. Bild-Upload im Editor macht den nächsten Speichervorgang zum Schein-Konflikt (409)

`client/src/components/NoteModal.jsx:329` (`uploadImages`) und `:347` (`deleteImage`) aktualisieren
`images`, aber nicht `baseUpdatedAtRef` (`:55`). Der Upload ändert serverseitig `updatedAt`, der
Editor hält weiter die alte Version → das neue Optimistic-Locking schlägt gegen die eigene App zu.

Live: Notiz öffnen → Bild hochladen (200, `updatedAt` neu) → Escape (speichert) →
`PUT /api/notes/:id` → **409** → Konfliktbanner „This note has been changed elsewhere in the
meantime", obwohl niemand anderes die Notiz angefasst hat. Der Nutzer muss dann „Load server
version" (verwirft seinen Text) oder „Overwrite" wählen.

Fix: `baseUpdatedAtRef.current = updatedNote.updatedAt || baseUpdatedAtRef.current;` nach beiden
Mutationen (die Antworten enthalten die frische Notiz).

### 7. Link-Vorschauen erscheinen in `npm run dev` nie (`mountedRef` wird nie zurückgesetzt)

`client/src/hooks/useLinkPreview.js:20` (`useRef(true)`), `:92` (`if (!mountedRef.current) return;`),
`:138` (`mountedRef.current = false`) — es gibt kein `mountedRef.current = true` im Mount-Effect.
`hooks/useAsync.js:63` hat genau dieses Reset (Fix Nr. 16), dieser Hook nicht.

React-18-StrictMode fährt mount → cleanup → mount; danach ist `mountedRef.current` dauerhaft `false`.
Folge im Dev-Server: Preview-Request läuft (200), Ergebnis wird verworfen, `fetchingPreview` bleibt
`true`, `linkPreviews` bleibt `[]`.

Live-Gegenüberstellung, gleicher Code/gleicher Inhalt `https://example.com/`:

- Produktions-Build: Vorschau sichtbar (`EXAMPLE.COM | Example Domain`), gespeichert mit Preview.
- Dev-Server: keine Vorschau, gespeichert mit `linkPreviews: []`.

(Verdeckt in Dev ironischerweise Fund 2 — deshalb fiel beides nicht zusammen auf.)

Fix: `useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);`

### 8. Nicht erreichbare/404-Links erzeugen HTTP 500 statt „keine Vorschau"

`server/routes/notes.js:235-243` + `server/utils/linkPreview.js:168-171`

```js
if (response.statusCode !== 200) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
```

kein `error.statusCode` → Route fällt auf `httpStatus.INTERNAL_SERVER_ERROR`. Live: Inhalt mit
`https://example.com/keeplocal` (antwortet 404) → `POST /api/notes/link-preview` → **500**
`{"error":"Fehler beim Abrufen der Link-Vorschau"}` + vollständiger Stacktrace im Server-Log.
Jeder tote Link, jede Paywall-403, jedes 5xx der Zielseite wird so zum eigenen Serverfehler
(in Produktion für den Nutzer ein generischer Fehlertoast, im Log Rauschen mit Stacktrace).

Fix: `createValidationError`-Pfad mit `statusCode = 502`/`422` (bzw. 404/403 der Zielseite als
„keine Vorschau" behandeln und `204`/leeres Objekt zurückgeben); der Client fängt das bereits
(`useLinkPreview.js:108-114` loggt nur).

### 9. AdminConsole ist kein Dialog: kein `role`, kein Fokus-Trap, kein Escape

`client/src/components/AdminConsole.jsx:118-124` — nur `useBackdropClose`, als einziges Overlay ohne
`useModalA11y` (Friends `:119`, Collaborate `:57`, Settings `:89`, NoteModal `:527`, ConfirmDialog `:30`
haben es).

Live-Probe (Produktions-Build): `role=null`, `aria-modal=null`, `document.activeElement=BODY`
(kein Initialfokus), Tab läuft in die App dahinter, **Escape schließt die Konsole nicht**
(`{"admin":true}` nach Escape), Fokus-Restore fehlt. Nutzerwirkung: Tastaturbedienung der
Benutzerverwaltung (Admin anlegen/löschen) ist unbrauchbar, Screenreader kündigen nichts an.

Fix: `useModalA11y({ onClose, active: true })` wie in Settings.jsx:89 + `role="dialog"`/
`aria-modal="true"`/`aria-labelledby` am `.admin-console`-Container.

### 10. ErrorBoundary ist immer Deutsch — `getBrowserLanguage` bekommt ein Array statt eines Katalogs

`client/src/components/ErrorBoundary.jsx:15` → `getBrowserLanguage(['de', 'en'], 'de')`,
`client/src/utils/browserLanguage.mjs:21` prüft `Object.prototype.hasOwnProperty.call(supportedLanguages, 'en')`.
Für ein Array ist das `false` (Index-Schlüssel sind `'0'`,`'1'`) → immer Fallback `'de'`.

Live: Chromium mit `en-US`, gesamte App englisch, Crash-Bildschirm komplett deutsch
(„Etwas ist schiefgelaufen", „App sicher aktualisieren", „Nur neu laden"). Ausgerechnet der
Notfall-Bildschirm ist damit für englische Nutzer nicht verständlich.

Fix: `getBrowserLanguage({ de, en }, 'de')` (bzw. `translations` importieren wie in
`LanguageContext.jsx:19`) — und `catalogs[stored]`-Check beibehalten.

### 11. Fix Nr. 12 (i18n) ist unvollständig: sichtbares Deutsch in englischer UI

Live auf dem Setup- und dem Settings-Screen (Browser `en-US`) mitgelesen:

- `components/Setup.jsx:70-72`: „Dies ist die erste Anmeldung. Bitte erstellen Sie ein
  Administrator-Konto …" — Fließtext direkt unter dem englischen Titel. Erster Bildschirm einer
  Neuinstallation, **kein** LanguageSelector (`Setup.jsx` mountet keinen, Login/Register schon).
- `components/Settings.jsx:121-122, 235, 241-245, 281, 284, 301-314, 324-327, 357, 366`:
  „Erstelle API-Keys für den externen Zugriff …", „Optionale KI-Funktionen für erweiterte
  Möglichkeiten", „Sprach-zu-Text Transkription", „Transkriptions-Konfiguration",
  „Whisper AI Service Einstellungen", Sprach-Optionen „Französisch/Niederländisch/Türkisch",
  „Server-Konfiguration:", „Admin-Konsole öffnen", „Hinweis: Die Admin-Konsole ermöglicht …"
  — direkt neben englischen Keys (`No API keys yet…`, `No expiry`, `Create`).
- Weitere Restlöcher: `App.jsx:200` `<p>Lade...</p>`, `App.jsx:66` `<kbd>Strg+N</kbd>`,
  `App.jsx:313` + `components/NoteForm.jsx:22` `aria-label="Neue Notiz erstellen"`,
  `components/Sidebar.jsx:72` `aria-label="Einstellungen"`,
  `components/NoteModal.jsx:681` („Bild löschen"), `:757` („Weitere Tags..."), `:848`
  („Bilder auswählen"), `:863` („Hochladen..."/„Bild(er) hochladen"), `:883-884`
  („Aufnahme stoppen"/„Transkribiere..."/„Sprachaufnahme starten"),
  `:941/:950/:955` („Schließen"/„Vorheriges Bild"/„Nächstes Bild"), `:708` („Entfernen"),
  `:715` („Neu"), `:743` ``title={`${tag} entfernen`}``,
  `components/LinkPreview.jsx:64-65` („Vorschau entfernen"),
  `index.html:2/16/19` (`lang="de"`, `<title>KeepLocal - Notizen App`, noscript-Text) — `lang="de"`
  ist bei englischer UI zusätzlich ein Screenreader-Fehler.

Die Kataloge selbst sind sauber: **236 verwendete `t()`-Keys, alle in `de.js` und `en.js` vorhanden,
305/305 Parität** (mechanisch geprüft). Es fehlen also nur die Aufrufe, nicht die Übersetzungen.

### 12. `/api/v1/tags` fliegt aus dem OpenAPI-Spec — YAML-Fehler im neuen Swagger-Block

`server/routes/v1/tags.js:25`

```yaml
description: "true" zählt Tags archivierter Notizen (Standard: false)
```

Ein Plain Scalar, der mit `"` beginnt, ist für YAML ein quoted scalar mit Müll dahinter.
`swagger-jsdoc` meldet beim **jeden** Serverstart:

```
Error in routes/v1/tags.js : YAMLSyntaxError: All collection items must start at the same column
at line 9, column 9:  - in: query
```

und verwirft den gesamten Pfad: `require('./config/swagger').paths` hat **9 statt 10 Einträge**,
`paths['/api/v1/tags'] === undefined`. `/api/docs` dokumentiert den Tags-Endpunkt also gar nicht —
inklusive des neuen `archived`-Parameters, den Fix Nr. 24 gerade eingeführt hat. Bisect gegen das
installierte `yaml`-Paket: Block ohne diese Zeile parst, mit ihr nicht; die Fehlermeldung zeigt
irreführend auf `- in: query`.

Fix: `description: 'Zählt mit archived=true die Tags archivierter Notizen (Standard: false)'`
(ganze Zeile quoten oder umformulieren). Zusätzlich sollte ein Test `swaggerSpec.paths` auf die
erwarteten Pfade prüfen — `server/tests/documentationContracts.test.js` läuft heute grün darüber weg.

### 13. Eingeloggte Nutzer können die Sprache nicht wechseln

`components/LanguageSelector.jsx` ist nur in `Login.jsx:96` und `Register.jsx:67` gemountet;
`Settings.jsx` bietet ausschließlich die **Transkriptions**-Sprache (`:288-295`). `changeLanguage`
existiert jetzt (`LanguageContext.jsx:32`, Fix Nr. 11), ist aber nach dem Login unerreichbar; der
Setup-Screen hat ebenfalls keinen Umschalter. Wer die App einmal auf Englisch benutzt, muss sich
ausloggen, um sie zu übersetzen — oder `localStorage.keeplocal_language` von Hand setzen.

Fix: `<LanguageSelector />` in die Settings-„General"-Sektion (und optional in `Setup.jsx`).

---

## LOW

### 14. `GET /api/friends/search?query=a&query=b` → 500 (Fix Nr. 25 nur für Notizen umgesetzt)

`server/routes/friends.js:223-224`: `const trimmedQuery = (query || '').trim();` — bei doppeltem
Query-Parameter ist `query` ein Array. Live: `500 {"error":"(query || \"\").trim is not a function"}`
(inkl. Stacktrace, weil NODE_ENV=development; in Produktion korrekt redacted, aber falscher Status).
`routes/notes.js:48` → `services/notesService.js:254/261` hat den `typeof === 'string'`-Guard
bekommen, `friends.js` nicht. Gleiche Prüfung für `?query[]=a`.
Fix: `typeof query === 'string' ? query.trim() : ''`.

### 15. Skeleton-Ladezustand ignoriert das Masonry-Layout

`client/src/App.jsx:47-59` rendert `.notes-skeleton` (`:49`), die Klasse ist in keiner CSS-Datei definiert
(mechanisch geprüft: 350 verwendete Klassen, `.notes-skeleton` und `.setup-info` ohne Regel).
Die echten Notizen stehen in `.note-list { column-count: 4 }` (`components/NoteList.css:2`), die
Skeleton-Cards (`.skeleton-card`, `App.css:579`) stapeln sich deshalb vollbreite untereinander →
Layoutsprung beim ersten Laden. `.setup-info` (`Setup.jsx:70`) ist ebenfalls ungestylt.

### 16. Drag & Drop innerhalb einer Sektion bleibt ein No-Op (Nr. 14 weiterhin offen)

`client/src/hooks/useNotesManager.js:510` wendet `reorder` lokal an, `:549-552` sortiert sofort wieder
nach `updatedAt`; persistiert wird nichts. Live: Reihenfolge vor dem Drop, direkt danach und nach einem
Refetch identisch. Zusätzlich `:510` ohne `invalidateInFlightFetches()` — der 60-s-Poll würde die
Reihenfolge ohnehin überschreiben. Produktentscheidung steht weiter aus (Order-Feld + API).

### 17. Doppel-Toast beim Drag zwischen den Sektionen

`useNotesManager.js:495-506`: `togglePinNote()` toastet bereits (`notePinned`/`noteUnpinned`),
`handleDrop` toastet danach nochmal `noteWasPinned`/`noteWasUnpinned`. Wegen Fund 4 sieht der Nutzer
nur die zweite Meldung ~1 s lang.

### 18. Tote Props: Admin-Einstieg in der Sidebar

`App.jsx:301-304` übergibt `isAdmin`/`onAdminClick` an `Sidebar`, `Sidebar.jsx:7-22` destrukuriert
sie nicht → Admin-Konsole nur über Settings erreichbar. Vorbestehend (identisch in `HEAD`), kein
Regression; beim Aufräumen miterledigen.

### 19. `SettingsContext`-Value nicht memoisiert

`client/src/contexts/SettingsContext.jsx:57-62`: neues Objekt pro Render → alle Consumer
(NoteModal, Settings) rendern bei jedem Provider-Render. `LanguageContext` macht es mit
`useCallback` vor. Kosmetik/Perf, kein Funktionsfehler.

---

## Nachgeprüft und für gut befunden (Auszug)

Live verifiziert, nicht nur gelesen:

- **Nr. 1**: `"Preis < 100 EUR & Tom <3 Jerry\nif a < b then c > d"` wird unverändert gespeichert und
  korrekt gerendert (`Preis &lt; 100 …` im HTML, Klartext im DOM); Todo-Items behalten `<`/`&`.
  Suche nach `<3` findet die Notiz (200, kein verworfener Filter). Globaler XSS-Filter ist raus
  (`middleware/sanitizeInput.js` gelöscht), die einzige `dangerouslySetInnerHTML`-Senke
  (`Note.jsx:161`) escaped vorher und fährt durch DOMPurify mit enger Tag-/Attr-Liste.
- **Nr. 2 + 4**: Logout → Login **ohne** Reload funktioniert, Mutation danach erfolgreich
  (CSRF-Token wird in `authAPI.js:150-153` geleert, 403-Retry in `apiUtils.js:88-95`).
- **Nr. 3**: `.modal-overlay` ist `position:fixed; inset:0; display:flex; z-index:2000`,
  Backdrop `rgba(0,0,0,.5)`, Friends-/Collaborate-/Settings-Modal zentriert und im Viewport.
- **Nr. 5**: `utils/normalizeEmail.js` ist in `admin.js:42` und `passport.js:18` eingebaut;
  `scripts/normalize-emails.js` ist Dry-Run-by-default und meldet Kollisionen statt sie umzuschreiben.
- **Nr. 6**: Admin legt Nutzer an, „Make admin" in der neuen Zeile funktioniert sofort (kein `undefined`).
- **Nr. 7**: Escape schließt die Lightbox, der Editor bleibt offen; zweites Escape speichert/schließt.
- **Nr. 8/9**: keine Doppel-Escapes mehr; Toast-`z-index` = `--z-lightbox` (über dem Modal).
- **Nr. 10/12 (Keys)**: 236 `t()`-Keys, `de`/`en` 305/305 paritätisch, kein fehlender Key.
- **Nr. 32/33**: Fokus-Trap + Fokus-Restore in ConfirmDialog (Cancel-Klick **und** Escape landen wieder
  auf dem Delete-Button) und im FriendsModal (zurück auf dem Sidebar-Button); Backdrop-Klick schließt.
- **Optimistic Locking**: `baseUpdatedAt` wird vom Client gesendet, 409 kommt mit `currentNote`,
  Banner + „Load server version" + Discard-Bestätigung funktionieren Ende-zu-Ende; `baseUpdatedAt`
  wird nicht persistiert.
- **Infra-Fixes**: `proxy_read_timeout 300s` in beiden Nginx-Varianten, Healthcheck auf
  `/api/health` in beiden Split-Compose-Dateien, `client_max_body_size 26M`, CSRF-/WHISPER-Prüfung im
  Entrypoint, Supervisor-Logrotation, `BAKED_WHISPER_MODEL`, `guard.js` (no-store in Nginx/Vercel/SW).
- Bild-Upload inkl. Thumbnail (`sharp`), privates `/uploads/images/…`-Serving und Lightbox funktionieren.
- Pagination/Query-Härtung: `?tag[$regex]=x` → 400, `?archived=maybe` → 400, `?page=abc` → 400,
  `?search=a&search=b` → 200 (kein 500 mehr).

Umgebungs-Artefakte (keine Produktfehler, nicht nachverfolgen): Font-403er im Vite-Dev-Server der
`/tmp`-Kopie (symlinktes `node_modules` außerhalb von `server.fs.allow`), `ERR_BLOCKED_BY_ORB` für
`https://example.com/pic.png` (absichtlich ungültige Bild-URL aus der API-Sonde), 404 für
`/service-worker.js` auf dem Audit-Static-Server (dort bewusst abgeschaltet).

---

## Empfohlene Reihenfolge

1. **Nr. 1** — eine Zeile, sonst ist jeder Speichervorgang ein App-Absturz (Showstopper, blockiert
   alles andere; ohne diesen Fix sind die übrigen Editor-Funde im Alltag nicht mal erreichbar).
2. **Nr. 2** — eine Zeile pro Validator, sonst ist „Link einfügen + speichern" kaputt.
3. **Nr. 3** — fünf kopierte Zeilen, sonst läuft die Split-Deployment-Referenz ohne CSP/Framing-Schutz.
4. **Nr. 6 + 5** — beide im NoteModal, kleine Änderungen, verhindern Schein-Konflikt bzw. Datenverlust.
5. **Nr. 4** — App.jsx auf `toastBus` umstellen (ToastStack ist schon gemountet), erledigt Nr. 17 mit.
6. **Nr. 7 + 8** — Link-Vorschau-Pfad komplett (Dev-Verhalten + Fehlerstatus).
7. **Nr. 9-13** — AdminConsole-A11y, ErrorBoundary-Sprache, i18n-Restlöcher, Swagger-YAML, Sprachumschalter.
8. **Nr. 14-19** nach Priorität; Nr. 16 bleibt Produktentscheidung.

Testlücken, die alle drei HIGH-Funde gemeinsam haben: kein Test rendert/entmountet den NoteModal, kein
Test schickt einen echten Link-Vorschau-Payload durch die HTTP-Validierung, kein Test prüft
`swaggerSpec.paths` oder Nginx-Header. Drei kleine Tests (NoteModal-Mount/Unmount mit Fake-Timer,
POST-Matrix mit `image: ""`, Spec-Pfad-Liste) würden diese Klasse dauerhaft abdecken.

---

## Behoben-Status (Update 2026-09-10, gleiche Sitzung)

Umfang dieser Runde: **74 Dateien geändert, +2328/−1517** (vorher 66/+1951), davon 4 neue
Testdateien. Kein Fund blieb unangetastet außer Nr. 16 (Produktentscheidung).

| # | Fund | Änderung | Verifikation |
|---|------|----------|--------------|
| 1 | NoteModal-Crash beim Schließen | `NoteModal.jsx:62-72` — Cleanup holt den Recorder in eine lokale Variable und prüft `recorder && recorder.state !== 'inactive'` | Prod-Build: Notiz speichern, Abbrechen, Escape → App lebt jeweils weiter; Dev/StrictMode: Editor öffnet ohne Crash. `client/tests/editorLifecycle.test.js` |
| 2 | 400 bei Link-Vorschau ohne Bild | `middleware/validators.js:107` und `:211` → `.optional({ checkFalsy: true })` | API: POST/PUT mit `image:""` → 201/200; `image:"not a url"` bleibt 400. Browser: Notiz mit Vorschau gespeichert (`previews:1, image:""`). `server/tests/linkPreviewPayload.test.js` |
| 3 | Split-Nginx ohne Security-Header | `client/nginx.conf:102-117` — die fünf Header aus `nginx-allinone.conf` ergänzt + Kommentar zur `add_header`-Vererbung | nginx 1.18 mit der echten Config: `GET /` → 200 mit Cache-Control **und** X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP |
| 4 | Toasts verdrängen sich / sterben früh | `App.jsx` publiziert jetzt auf `toastBus` (`showToast`), lokaler Toast-State und `<Toast>` entfernt; `<ToastStack />` bleibt der einzige Host. `ToastStack.jsx`-Kommentar aktualisiert | Prod-Build: Pin + Archiv 750 ms auseinander → 2 Toasts gleichzeitig sichtbar, „Note unpinned“ 492→3436 ms, „Note archived“ 1229→4172 ms (~2,9 s statt 0,3–1,1 s). `client/tests/toastQueue.test.js` |
| 5 | Backdrop-Drag schließt/verwirft den Editor | `NoteModal.jsx:490-508` — `useBackdropClose(handleOverlayClick)` statt rohem `onClick` am Overlay | Echter Maus-Drag (mousedown im Titel, mouseup auf dem Backdrop): Modal bleibt offen, Titel-only-Notiz bleibt erhalten. Reiner Backdrop-Klick speichert weiterhin. `componentDialogs.test.js` (alle 5 Overlays) |
| 6 | Schein-409 nach Bild-Upload | `NoteModal.jsx:329-337` und `:349-356` — `baseUpdatedAtRef.current = updatedNote.updatedAt` nach Upload/Löschen | Prod-Build: Bild hochladen → Text ergänzen → Speichern → kein Konfliktbanner, Modal schließt. `editorLifecycle.test.js` |
| 7 | Keine Link-Vorschauen in `npm run dev` | `hooks/useLinkPreview.js:131-141` — Mount-Effect setzt `mountedRef.current = true` (Cleanup `false`) | Dev-Server (StrictMode): Vorschau gerendert **und** mit der Notiz gespeichert (`previews:1`). `editorLifecycle.test.js` |
| 8 | Toter Link → HTTP 500 | `utils/linkPreview.js:169-180` — Fehler bekommt `statusCode = 502`; `routes/notes.js:235-244` loggt erwartbare Upstream-Fehler ohne Stacktrace | `POST /api/notes/link-preview` mit 404-Ziel → **502** `{"error":"Zielseite antwortete mit HTTP 404"}`, Log nur noch `Link preview skipped: …`; 200-Ziel → 200. `linkPreviewPayload.test.js` |
| 9 | AdminConsole ohne Dialog-Semantik | `AdminConsole.jsx` — `useModalA11y({ onClose })`, `ref`, `role="dialog"`, `aria-modal`, `aria-labelledby={titleId}` am `<h2>` | Prod-Build: `role=dialog`, `aria-modal=true`, Fokus im Dialog, **Escape schließt**. `componentDialogs.test.js` |
| 10 | ErrorBoundary immer Deutsch | `ErrorBoundary.jsx:15` — `getBrowserLanguage(catalogs, 'de')` statt Array | `translations.test.js` prüft den Aufruf; en-US-Browser bekommt englische Setup-/Settings-Texte (Boundary-Texte kommen aus demselben Resolver) |
| 11 | Hartkodiertes Deutsch | `Settings.jsx` (API-Keys/KI/Transkription/Server-Config/Administration + 15 Sprachoptionen), `Setup.jsx:70-73`, `NoteModal.jsx` (9 Attribute + Badge/Tag-Titel), `NoteForm.jsx:22`, `Sidebar.jsx:72`, `LinkPreview.jsx` (2), `App.jsx` (`loadingApp`, `shortcutCtrlN`, `openMenu`, `toggleTheme`, `settings`) — ~55 neue Keys in `de.js`/`en.js` | en-US-Parcours: Setup- und Settings-Screen komplett englisch (automatischer Umlaut-/Wortlistenscan über alle Komponenten leer); `translations.test.js` mit 3 neuen Guards (JSX-Text, Attribute, alle `t()`-Keys gegen beide Kataloge) |
| 12 | `/api/v1/tags` fehlt im OpenAPI-Spec | `routes/v1/tags.js:25` — Beschreibung ohne führendes `"true"` | Serverstart ohne YAMLSyntaxError; `/api/docs.json` → **10 Pfade**, `/api/v1/tags` mit `archived`-Parameter. Neuer Test in `documentationContracts.test.js` |
| 13 | Kein Sprachwechsel im eingeloggten Zustand | `Settings.jsx` — neue Sektion „Sprache“ mit `<LanguageSelector />`; `Setup.jsx` bekommt den Selektor wie Login/Register; `LanguageContext.jsx:32-42` setzt `document.documentElement.lang` + `document.title` | Prod-Build: Umschalten auf Deutsch in den Settings → `<html lang="de">` + deutsche UI, zurück auf English funktioniert; `translations.test.js` |
| 14 | `friends/search` 500 bei Array-Param | `routes/friends.js:223-227` — `typeof query === 'string' ? query.trim() : ''` | `?query=a&query=b` und `?query[]=a` → **200 `[]`**; normale Suche weiterhin mit escaptem Regex; >100 Zeichen → 400. `server/tests/friendsSearchQuery.test.js` |
| 15 | Skeleton ohne Layout | `App.css:566-604` — `.notes-skeleton` mit denselben `column-count`-Stufen wie `.note-list` + `break-inside: avoid`; `Auth.css` — `.setup-info` | Build clean; Klassenexistenz-Scan (350 Klassen) meldet `.notes-skeleton`/`.setup-info` nicht mehr |
| 16 | Drag&Drop-Reorder | **offen** (Produktentscheidung: persistiertes Order-Feld + API) | — |
| 17 | Doppel-Toast beim Drag | `useNotesManager.js:495-501` — zweiter Toast entfernt (`togglePinNote` toastet selbst), Deps bereinigt | `toastQueue.test.js` |
| 18 | Tote Sidebar-Props | `App.jsx:296-300` — `isAdmin`/`onAdminClick` nicht mehr an `Sidebar` übergeben (Admin-Einstieg bleibt in Settings) | ESLint/Build clean |
| 19 | SettingsContext-Value nicht memoisiert | `SettingsContext.jsx` — `useMemo(…, [settings])` | Build clean |

**Neue Tests** (dieser Runde): `server/tests/linkPreviewPayload.test.js` (5),
`server/tests/friendsSearchQuery.test.js` (4), `documentationContracts.test.js` (+1 Swagger-Pfad-Check),
`client/tests/editorLifecycle.test.js` (4), `client/tests/toastQueue.test.js` (4),
`componentDialogs.test.js` (+2: AdminConsole-Dialogsemantik, Backdrop-Guard aller Overlays),
`translations.test.js` (+5: keine deutschen JSX-Texte/Attribute, alle `t()`-Keys in beiden Katalogen,
ErrorBoundary-Sprachauflösung, `<html lang>`-Sync, LanguageSelector-Mounts).
Suiten: **Server 79 → 89**, **Client 107 → 121**, alle grün.

**Bewusst nicht geändert:** `index.html` bleibt `lang="de"` als Auslieferungszustand (JS setzt das
`lang`-Attribut jetzt beim Start korrekt), der `noscript`-Text ist zweisprachig, und die
Drag&Drop-Persistenz (Nr. 16) wartet auf die Produktentscheidung.

---
---

# Runde 3 — 10 weitere Punkte (gleiche Sitzung, nach dem Fix-Durchgang)

Methode wie in Runde 2 (laufender Stack: MongoDB-Container, Server aus dem Working Tree,
Vite-Dev **und** Produktions-Build, Puppeteer/Chromium), zusätzlich:

- **zweiter Browser-Kontext** (isolierte Cookies) für echte Zwei-Nutzer-Tests (Besitzerin `alice`,
  Mitbearbeiter `bob`, Dritte `carol` ohne Freundschaft),
- **eigener Static-Server mit absichtlich kaputtem Bundle** (`index.html` referenziert
  `/assets/index-DEADBEEF.js` → 404), um `guard.js`/`recover.html` im echten Fehlerfall zu fahren,
- API-Matrizen mit zwei Cookie-Jars (Teilen, Kollaboration, Transkription, User-Anlage),
- Flask-Tests im All-in-One-Image (lokal kein Flask installiert).

Ausgangsstate: Server 89/89, Client 121/121, AI 4/4, ESLint/Build clean.

## HIGH

### 20. Ctrl+N kapert den offenen Editor → Speichern legt ein Duplikat an
`client/src/App.jsx` (`openNoteModal`), ausgelöst über `useKeyboardShortcuts('Ctrl+n')` →
`NoteForm.focus()` → `buttonRef.click()`.

`openNoteModal(note = null)` ersetzte den Modal-State bedingungslos. War der Editor mit einer
bestehenden Notiz offen, kippte `noteModal.note` auf `null`, während `NoteModal`'s Sync-Effect für
`note === null` früh aussteigt (`applyNoteToForm` → `if (!source) return`) und das Formular die alten
Werte behält. `handleModalSave` wählt über `noteModal.note ? update : create` → **Create**.

Live (Produktions-Build): Notiz „Page-Note 55" geöffnet, Text ergänzt, Ctrl+N, Speichern →
`total 55 → 56`, zwei Notizen „Page-Note 55". Die Toolbar verriet den Moduswechsel bereits
(nur noch `Open color picker / Switch to list / Pin` — Archive, Share, Delete waren weg).

Fix: `setNoteModal(prev => (prev.isOpen ? prev : { isOpen: true, note }))`.
Verifikation: Editor behält Titel und Owner-Tools, `total 60 → 60`, `client/tests/collaborationUi.test.js`.

### 21. Kollaboration war schreibend unmöglich — die UI versprach trotzdem volles Editieren
`server/services/notesService.js` (`updateNote`, `togglePinNote`, `toggleArchiveNote`, `deleteNote`,
`getOwnedNoteById`), `server/routes/notes.js:257/435` (`requireOwnedNote`),
`client/src/components/Note.jsx`, `client/src/components/NoteModal.jsx`.

Alle Schreibpfade filterten auf `{ _id, userId }`. Geteilte Notizen landen aber über
`buildNotesQuery` (`sharedWith: userId`) in der Liste des Mitbearbeiters, und Note-Karte wie Editor
zeigten unverändert alle Aktionen. Folge: jeder Versuch endet mit 404 „Notiz nicht gefunden".

Live (bob auf alices geteilter Notiz): `PUT` → **404**, `pin` → 404, `archive` → 404, `DELETE` → 404,
Bild-Upload/Transkription ebenso — während der Editor voll bedienbar aussah. Dabei ist gemeinsame
Bearbeitung die erklarte Absicht des Features (CollaborateModal, `noteShared`, und der extra für
„Live-Refresh geteilter Notizen" gebaute 60-s-Poll in `useNotesManager`).

Fix (Server): neuer `noteEditQuery(noteId, userId)` = `{ _id, $or: [{ userId }, { sharedWith: userId }] }`
für `updateNote` und `togglePinNote`. Destruktives/Strukturelles bleibt beim Besitzer
(`deleteNote`, `toggleArchiveNote`, `shareNote`/`unshareNote`, `getOwnedNoteById` für Uploads und
Transkription).
Fix (Client): `client/src/utils/noteAccess.mjs` (`noteOwnerId`, `isNoteOwner`, `noteOwnerName`);
`Note.jsx` zeigt Archive/Share/Delete nur noch für `canManage` (Pin bleibt), `NoteModal.jsx` blendet
Archive/Share/Delete/Bild-Auswahl/Upload/Löschen/Aufnahme aus und zeigt den Hinweis
`sharedNoteOwnerHint` („Von {owner} geteilt …").

Verifikation: bob `PUT` → **200** (`content="Bobs Aenderung"`), `pin` → **200**, alice sieht Bobs
Änderung; bob `archive`/`DELETE` → 404 (gewollt); bob sieht im Editor den Hinweis, keine Owner-Tools,
Speichern erfolgreich; auf der Karte nur noch der Pin-Button. `server/tests/noteCollaboration.test.js` (7),
`client/tests/noteAccess.test.js` (3), `client/tests/collaborationUi.test.js`.

## MEDIUM

### 22. Teilen ohne Freundschaft: Notizen ließen sich in beliebige Konten pushen
`server/services/notesService.js` (`shareNote`)

`POST /api/notes/:id/share {userId}` prüfte nur, dass das Ziel existiert. Benutzer-Ids sind über
`GET /api/friends/search?query=<name>` auffindbar (liefert `_id` + `username`, Limit 10). Damit konnte
jede authentifizierte Nutzerin fremden Konten Notizen unterschieben — inklusive Link-Vorschauen und
Bildern, die dort sofort in der Liste erscheinen. Das CollaborateModal listet zwar nur Freunde, die
API kannte diese Grenze nicht.

Live: alice teilt mit `carol` (keine Freundin) → **200**, carols Notizliste zeigt danach „Share-Test".

Fix: Freundschaftsprüfung gegen `owner.friends` → sonst **403** „Notizen koennen nur mit Freunden
geteilt werden". Verifikation: 403 für carol, carol sieht die neue Notiz nicht; Teilen mit bob (Freund)
weiterhin 200. `server/tests/noteCollaboration.test.js`.

### 23. CollaborateModal zeigte den Share-Zustand veraltet an
`client/src/components/CollaborateModal.jsx`

App setzt `collaborateNote` nur beim Öffnen; `handleNoteShared` aktualisiert die Notizliste, nicht das
Modal-Prop. `sharedWithIds` blieb also leer: Nach erfolgreichem Teilen stand der Button weiter auf
„Share", die „Geteilt mit"-Sektion fehlte — und ein zweiter Klick **ent-teilte** die Notiz, während die
UI „Teilen" anzeigte.

Live: Teilen → Toast „Note shared", Button bleibt `Share`, `sharedSection: null`.

Fix: lokaler `currentNote`-State (aus dem Prop gespiegelt, nach jeder Share/Unshare-Antwort
aktualisiert). Verifikation: Button sofort „✓ Shared", Sektion „SHARED WITH | bob | ×" sichtbar.

### 24. Notfall-Pfad (guard.js → recover.html) endete in einer leeren Seite und löschte Einstellungen
`client/public/guard.js`, `client/public/recover.js`

`recover.js` rief `repair()` **bedingungslos** auf: Preferences löschen (`theme`, `keeplocal_settings`,
`token`), Service Worker/Caches entfernen, sofort `location.replace('/?app-repair=…')` — die Seite war
nie lesbar. `guard.js` blockierte danach 60 s. Bei einem echten Defekt (Bundle fehlt) entstand:
leere Seite → Auto-Reparatur → leere Seite → **kein Ausweg**, und jede Runde warf die lokalen
Einstellungen weg.

Live (kaputter Static-Server): `/` → `recover.html?from=guard` → `/?app-repair=…` → `text=""`,
kein weiterer Redirect (Flag), Buttons nie sichtbar.

Fix: `guard.js` leitet beim ersten Versuch mit `auto=1` und bei jedem weiteren mit `auto=0` weiter
(nur noch 2-s-Doppelfeuerschutz statt 60-s-Sperre — Unterdrücken wäre die Strandung gewesen);
`recover.js` auto-repariert ausschließlich bei `from=guard && auto!=0` und höchstens einmal pro
Tab-Session (`sessionStorage`), **ohne** Preferences zu löschen; der manuelle Klick löscht sie weiter.
Ohne Auto-Reparatur zeigt die Seite Status „Ready/Bereit" + sichtbaren Retry-Button. Zusätzlich
zweisprachig (de/en, `document.documentElement.lang`, alle Texte über Ids), da die Seite React-frei ist.

Verifikation (Trace): `0.0s /` → `4.1s recover.html?…&auto=1` → `4.6s /?app-repair=…` →
`8.7s recover.html?…&auto=0` → UI `lang=en`, „Ready / An automatic repair already ran in this tab",
Retry sichtbar, **bleibt 9 s stabil** (kein Loop). `client/tests/recoveryPage.test.js` (+3 Tests).

### 25. Server und Client sortierten nach unterschiedlichen Schlüsseln
`server/services/notesService.js` (`getAllNotes`: `.sort({ isPinned: -1, createdAt: -1 })`) gegen
`client/src/hooks/useNotesManager.js:549` (`byRecency` auf `updatedAt || createdAt`).

Die Paginierung schnitt nach `createdAt`, die Anzeige sortierte nach `updatedAt` → kürzlich editierte
alte Notizen lagen auf hinteren Seiten, obwohl sie in der Ansicht nach oben gehören; über Seitengrenzen
war die Reihenfolge widersprüchlich.

Fix: `.sort({ isPinned: -1, updatedAt: -1, createdAt: -1 })` + neuer Index
`{ userId: 1, isPinned: -1, isArchived: 1, updatedAt: -1 }` (`models/Note.js`), der alte bleibt.
Verifikation: die älteste Notiz („Page-Note 01", Seite 2) springt nach einem Edit auf Platz 2 von
Seite 1; Unit-Test prüft den Sort-Call.

## LOW

### 26. `language=auto` — der Default der App — wurde als ungültiger Sprachcode abgelehnt
`server/routes/notes.js:462-467` (`/^[a-z]{2,3}(?:-[A-Z]{2})?$/`) und `ai/app.py:31-36` (gleiches
Muster) gegen `client/src/utils/settingsPayload.mjs` (`transcriptionLanguage: 'auto'`) und
`Settings.jsx` (`<option value="auto">`).

Nur das Browser-Bundle filtert `'auto'` heraus (`notesAPI.js:167`). Jeder andere Client (Scripts,
mobile Anbindungen, direkte API-Nutzung) bekam `400 Ungueltiger Sprachcode` — bei einer Option, die
die UI selbst als „Automatisch erkennen" anbietet.
Live: `POST /api/notes/:id/transcribe` mit `language=auto` + gültigem WAV → **400**.
Fix: Route und Flask mappen `'auto'` auf „kein Sprach-Hint". Verifikation: `auto`/`de` passieren die
Validierung (danach 500/503, weil hier kein AI-Container läuft), `Klingon1` → weiterhin 400;
AI-Suite 5/5 inklusive `test_auto_language_means_no_hint`.

### 27. Nach erfolgreichem OAuth-Redirect blitzte das Login-Formular auf
`client/src/App.jsx` ( Callback-Zweig prüfte `getBrowserPathname()`, das durch das `replaceState('/')`
in `OAuthCallback` bereits '/' war, während `/api/auth/me` noch lief → `!isLoggedIn` → Login-Screen)
und `client/src/components/OAuthCallback.jsx` (Effect-Deps `[onOAuthSuccess, t]` mit inline erzeugtem
`onOAuthSuccess` → lief bei jedem Render erneut, las die bereits bereinigte URL und rief `setError`
an einer sterbenden Komponente).

Fix: `oauthCallback`-State in App (bleibt bis zum Abschluss der Session-Erkennung), `handledRef` +
leere Deps in OAuthCallback, tote `|| 'Fallback'`-Ketten entfernt.

### 28. Offline-Antwort des Service Workers war hartkodiert deutsch
`client/public/service-worker.js:66-78` lieferte `{"error":"Offline - API nicht verfügbar"}`, das über
`parseResponse` → `error.message` unverändert in Toasts landete (auch in englischer UI).
Fix: sprachneutrales `{"code":"OFFLINE"}`; `apiUtils.createHttpError` erzeugt bei einem Payload mit
`code` aber ohne `error` eine **leere** Message und setzt `error.code`, sodass alle Aufrufer auf ihre
übersetzten `t(...)`-Fallbacks zurückfallen.

### 29. Benutzername nur case-sensitiv eindeutig
`server/models/User.js` (`username: unique`, kein `lowercase`, im Gegensatz zu `email`) +
Duplikatprüfungen in `routes/auth.js`, `routes/admin.js`, `services/adminService.js`; die
Freundessuche matcht dagegen case-insensitive (`routes/friends.js:236`).
Live: `ALICE` neben `alice` angelegt → **201**; beide in der Suche nicht unterscheidbar.
Fix: case-insensitive Duplikatprüfung (`^${escapeRegex(username)}$` mit Flag `i`) in allen drei Pfaden
— bewusst **kein** kollationsbasiertes Unique-Index, weil ein bestehendes Paar den Index-Build und
damit den Start blockieren würde (Startup wartet auf alle Indizes).
Verifikation: `frank` → 201, `FRANK` → 400, `FrAnK` → 400. `server/tests/usernameCasing.test.js` (6).

## Geprüft und für gut befunden (Runde 3)

Pagination (Seite 1/2 vor/zurück bei 55 Notizen, Label „Page 2 of 2"), Tag-Filter (11 Treffer) und
Zurücksetzen, Archiv-Counts/Ansicht/Unarchive, API-Key-Erzeugung (einmalige Anzeige + Copy) und
Widerruf, Session-Expiry (401 → Banner + Logout), Mobile 390×844 (kein horizontaler Overflow,
Hamburger-Sidebar, Editor passt ins Viewport), alle fünf Themes erreichbar und mit ausreichendem
Kontrast (Δ-Luminanz 138–255), Farbpalette Client/Server identisch (12/12), Tag-Drag&Drop von der
Sidebar auf Notizen funktioniert, CSRF (HMAC, timingSafeEqual, Sliding-Cookie, 403-Retry),
`secureFileServe` (Pfad-Regex + Ownership), `apiKeyAuth` (SHA-256-Hash, `isActive`, Expiry, Ownership),
Admin-Schutz gegen Selbst-Löschen/Selbst-Entmachten (kein Letzter-Admin-Lockout möglich),
`deleteUser` räumt Freunde/Shares/API-Keys/Notizen/Dateien in der richtigen Reihenfolge auf,
`errorHandler` redigiert in Produktion (`details` nur development), Notes-Indizes passend,
OAuth-Vertrag (`#success=1` / `?error=…` / State-Cookie), Login/Register-Gating
(`registrationEnabled`, `providers`, Demo-Panel), `useBackdropClose`/Fokus-Trap in allen Overlays,
guard.js CSP-konform und in nginx/Vercel/SW auf no-store.

## Beobachtet, bewusst nicht geändert

- Drag&Drop-Reihenfolge (Runde 2, Nr. 16) — wartet auf die Produktentscheidung (Order-Feld + API).
- `services/adminService.createUser` wird von keiner Route verwendet (`routes/admin.js` implementiert
  inline). Beide Pfade haben jetzt dieselbe Prüfung; die Zusammenlegung ist reines Cleanup.
- `useKeyboardShortcuts` meldet den Window-Listener bei jedem Render neu an (App übergibt ein
  Objekt-Literal), und `Ctrl+Shift+L` loggt ohne Rückfrage aus — beides unkritisch, Kandidaten für
  eine nächste Runde.
- `ThemeToggle` ignoriert das `aria-label`-Prop aus App.jsx (verwendet den Theme-Wechsel-Titel).
- Einstellungen (Theme, AI-Features, Transkriptionssprache) liegen nur im localStorage des Geräts und
  werden beim Logout nicht geleert — bräuchte einen Account-Settings-Endpoint (Produktentscheidung).

## Stand nach Runde 3

- Server **106/106** (89 → 106, +17), Client **133/133** (121 → 133, +12), AI **5/5** (4 → 5).
- ESLint clean, `vite build` clean (158,16 kB JS gzip 48,36 kB), `docker compose config` für
  compose/compose.npm/compose.allinone OK (Demo-Variante verlangt weiterhin den sha256-Pin),
  `bash -n entrypoint.sh`, `python -m py_compile`, `node --check` für guard/recover/service-worker OK,
  Swagger-Spec 10 Pfade inkl. `/api/v1/tags`.
- Neue Tests: `server/tests/noteCollaboration.test.js` (7), `server/tests/transcribeLanguage.test.js` (4),
  `server/tests/usernameCasing.test.js` (6), `ai/test_app.py` (+1),
  `client/tests/noteAccess.test.js` (3), `client/tests/collaborationUi.test.js` (6),
  `client/tests/recoveryPage.test.js` (+3); angepasst: `componentDialogs`, `publicDemoMode`,
  `notesManagerLogic` (App.jsx-Obergrenze 400 → 420 Zeilen, begründet im Test).
- Live-Parcours nach den Fixes: **11/12** (der eine FAIL war eine zu grobe Abtastung im Skript — der
  dedizierte Guard-Trace zeigt `auto=1` → Reparatur → `auto=0` → stabile Recovery-UI) und
  **8/8** Regressions-Checks zu Runde 2 (Backdrop-Drag, Upload ohne Schein-409, Settings englisch,
  AdminConsole-Escape), plus Toast-Queue (2 gleichzeitig, ~2,9 s) und Dev-Server (Editor öffnet,
  Link-Vorschau erscheint und wird gespeichert).
- Geänderte Dateien dieser Runde: `ai/app.py`, `ai/test_app.py`, `client/index.html`,
  `client/public/{guard.js,recover.html,recover.js,service-worker.js}`,
  `client/src/App.{css,jsx}`, `client/src/components/{AdminConsole,CollaborateModal,ErrorBoundary,LinkPreview,Note,NoteForm,NoteModal,OAuthCallback,Settings,Setup,Sidebar,ToastStack}.jsx`,
  `client/src/components/{Auth,NoteModal,Settings}.css`, `client/src/contexts/{LanguageContext,SettingsContext}.jsx`,
  `client/src/hooks/{useLinkPreview,useNotesManager}.js`, `client/src/services/api/apiUtils.js`,
  `client/src/translations/{de,en}.js`, `client/src/utils/noteAccess.mjs` (neu),
  `server/models/Note.js`, `server/routes/{admin,auth,friends,notes,v1/tags}.js`,
  `server/services/{adminService,notesService}.js`, `server/utils/linkPreview.js`
  sowie die oben genannten Tests. Kumuliert im Working Tree: **83 Dateien, +2736/−1606**.
