# KeepLocal Bug Report — 2026-08-15

> **Fix-Status (Update 2026-08-17):** Nr. 1–11, 13, 15–20, 22–25, 27–33 sind im
> Working Tree behoben; **Nr. 12 (i18n) ist jetzt ebenfalls abgeschlossen**
> (Register, Setup, Settings, CollaborateModal, ErrorBoundary, App-Toasts,
> Pagination, Datums-Locales; Kataloge de/en mit Parity-Test). Server 66/66,
> Client 53/53, ESLint/Build/Compose grün. Zusätzliche Production-Readiness-
> Verbesserungen: Graceful Shutdown, Swagger-Gate in Produktion, CI-Workflow,
> Supervisor-Log-Rotation, Backup-/Restore-Doku.
> Migrationshinweis zu Nr. 5: für Altbestand nicht-kanonischer E-Mails existiert
> jetzt `server/scripts/normalize-emails.js` (Dry-Run-Default, `--write`,
> Kollisionen werden nur gemeldet).
> Bewusst offen: Nr. 14 (Drag&Drop-Ordnung braucht ein persistiertes Order-Feld
> + API — Produktentscheidung), Nr. 21 Teilfix (no-store auf `location /`
> ergänzt), Nr. 26 (Datei-GC/Queue braucht Infrastruktur).

Base: Branch `agent/refresh-stale-files`, Commit `c8b4e58`.
Methode: 5 parallele Deep-Read-Jäger (Server-Auth, Server-Datenlayer, Client-Core, Client-Komponenten, Infra/AI/Doku), danach manuelle Verifikation jedes Fundes gegen den Code; die HIGH-Funde wurden zusätzlich reproduziert (Node-REPL gegen die installierten Pakete).
Vorhandene Suiten bei der Jagd: Server 59/59, Client 52/52, ESLint clean, Vite-Build clean, `docker compose config` OK (Demo-Variante verlangt per Design sha256-Pin).
Abgrenzung: Alles, was AUDIT_REPORT.md bereits als gefixt listet, wurde geprüft und NICHT erneut gemeldet — bis auf zwei Fälle, in denen der Fix unvollständig ist (Nr. 20, 21).

## HIGH — Datenverlust / Kernfunktionen gebrochen

### 1. Globaler XSS-Filter löscht stillschweigend Notizinhalt mit `<`
`server/middleware/sanitizeInput.js:8` (global gemountet `server/server.js:142`) + `server/utils/sanitize.js:13-26,37`
`sanitizeObject` läuft mit `stripIgnoreTag: true` über jeden String in Body/Query, bevor irgendeine Route ihn sieht. Reproduziert gegen installiertes `xss@1.0.14`:
- `"Preis < 100 EUR"` → gespeichert als `"Preis "` (alles ab `<` weg)
- `"if a < b then c > d"` → `"if a  d"`; `"1<2 and 3>2"` → `"12"`
- `"<3"` → `""` → POST /api/notes scheitert mit irreführendem 400 „Inhalt ist erforderlich"
- `?search=<3 hearts` → Filter still fallen gelassen (200, alle Notizen)

Server antwortet 201/200 ohne Fehler; der Client zeigt nach Reload halbe Notizen. Betrifft `content`, `title`, `todoItems[].text`, `search`, `tag`. Der bestehende Test prüft nur `<script>`-Entfernung.
**Fix:** HTML-Filter nicht auf Klartextfelder anwenden (Client sanitizt beim Render via DOMPurify) oder zerstörungsfreies Escaping verwenden.

### 2. CSRF-403-Sperre ohne Selbstheilung — zwei Trigger
Client: `client/src/services/api/apiUtils.js:7,42-44` (Token im Modul-Scope), `authAPI.js:4-15` (Refetch nur wenn `null`), kein 403-Retry. Server: `csrfProtection.js:53-60`.
- **Trigger A (sofort, reproduzierbar):** Login → Logout (ohne Reload). Server löscht beide Cookies (`server/routes/auth.js:291-292`), Client behält Token im Speicher → jede weitere Mutation (inkl. erneutem Login) 403 „Ungültiges CSRF-Token". Nur F5 hilft.
- **Trigger B (8 h):** `kl_csrf`-Cookie maxAge 8 h wird nur bei Erzeugung gesetzt, nie verlängert (`issueCsrfToken` setzt Cookie nur wenn `token !== existing`); Session hält 7 d. Tab > 8 h offen → alle Mutationen 403.
**Fix:** `setCsrfToken(null)` im Logout; bei 403 einmal `initializeCSRF()` + Retry; Cookie bei jedem `/api/csrf-token`-Response neu setzen.

### 3. `.modal-overlay` hat keinerlei CSS — Freunde- und Teilen-Modal sind kaputt
`client/src/components/FriendsModal.jsx:108`, `CollaborateModal.jsx:53`. Klasse ist in keiner CSS-Datei definiert (nur `.note-modal-overlay` existiert). Die „Overlays" rendern als ungestylte In-Flow-Blöcke unter dem App-Container (`.App` ist `overflow:hidden; height:100vh`) — ohne Backdrop, ohne Zentrierung, unter dem Falz abgeschnitten. Beide Features faktisch unbenutzbar.
**Fix:** `.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:var(--z-modal) }` oder Portal-Muster wie ConfirmDialog.

## MEDIUM — Funktionalität

4. **Logout fails open** — `authAPI.js:142-153` schluckt den 403; `sessionVersion` wird nicht gebumpt, `kl_session` (bis 7 d) überlebt. Nach sichtbarem Logout ist der Browser bei Reload wieder eingeloggt (Shared-Machine-Risiko). (Kombiniert mit Nr. 2.)
5. **Drei E-Mail-Kanonisierungen** — Login/Register: `.normalizeEmail()` (`auth.js:123,210`, strippt Gmail-Punkte + Subadressierung); Admin-Anlage: nur `trim().toLowerCase()` (`admin.js:41`); OAuth: rohe Provider-Email (`passport.js:13,30`). Folge (a): Admin-angelegter User `john.doe@gmail.com` kann sich NIE einloggen (keine Eingabeform matcht die gespeicherte Form; kein Reset-/Passwort-Edit-Endpoint existiert). Folge (b): OAuth-Login verfehlt den bestehenden Local-Account → Duplikat oder „Registrierung deaktiviert".
6. **AdminConsole: neuer User ohne `_id`** — Server antwortet `{ id }` (`admin.js:97`), Client appended `response.user` und agiert auf `user._id` (`AdminConsole.jsx:87,319,327-336`) → `PATCH/DELETE /api/admin/users/undefined` → 400. Bis zum Tab-Wechsel defekt.
7. **Lightbox schließt und speichert den ganzen Editor** — `NoteModal.jsx:771` Overlay/X ohne `stopPropagation` → Bubbling zu `handleOverlayClick` → `handleSave()`; Escape doppelt (Lightbox-Window-Listener + `useModalShortcuts`, der `lightboxImage` nicht prüft). Nutzer will nur den Bildbetrachter schließen und verliert den Editor.
8. **Double-Escape in Notizkarten** — `Note.jsx:134,151` nutzt `{sanitize(...)}` als JSX-Text; `sanitize()` gibt DOMPurify-serialisiertes HTML zurück → `Tom & Jerry` zeigt `Tom &amp; Jerry`, `a < b` zeigt `a &lt; b`. Fix: Klartext rendern, React-Escaping reicht.
9. **Fehler-Toast hinter dem Modal** — `Toast.css:18` z-index `var(--z-modal)`=2000 == `NoteModal.css:17`=2000, Toast früher im DOM → Speicherfehler komplett verdeckt. Fix: `var(--z-lightbox)`.
10. **Fehlende i18n-Keys rendern rohe Keys** — `t('settings')` (App.jsx:471 aria, AdminConsole.jsx:145 Tab-Titel „⚙️ settings"), `t('addMoreTags')` (NoteModal.jsx:588 Placeholder), `t('note')` (Note.jsx:124) — in de.js UND en.js nicht definiert; die `|| 'Fallback'`-Ketten greifen nie, weil der Key-String truthy ist.
11. **Sprachumschaltung ist tot** — `LanguageContext` exponiert kein `changeLanguage` (nur internes `setLanguage`), `LanguageSelector.jsx:7,46` ruft es trotzdem und ist nirgends gemountet. App bleibt dauerhaft auf Browsersprache trotz vollständiger de/en-Kataloge.
12. **Große UI-Teile hardcoded Deutsch** — Register.jsx komplett, Settings.jsx, Toast-Meldungen (noteCreated/noteUpdated/noteDeleted…), Pagination „Zurück/Weiter", `de-DE`-Datumswerte (AdminConsole.jsx:222,323; Settings.jsx:165-170) — die en-Keys existieren ungenutzt.
13. **Tastaturfokus im gesamten Editor unsichtbar (WCAG 2.4.7)** — `NoteModal.css:117-125,153-156,264-267,588-591`: `outline:none` + `:focus-visible { outline:none; box-shadow:none }` + transparenter Title-Unterstrich. Der Test `noteModalFocusStyles.test.js:19-58` zementiert das Fehlverhalten.
14. **Drag&Drop in derselben Sektion = no-op** — `App.jsx:272-281` sortiert lokal, das `useMemo` (322-336) resortiert sofort nach `updatedAt`; nichts wird persistiert. Tote Feature-Intention.
15. **Link-Preview-Logik (3 Teilbugs)** — `useLinkPreview.js`: (a) URL-Wechsel während des Fetchs → falsche Preview wird gespeichert (Fetching-Ref blockt Re-Fetch, Effect-Dep nur `[content]`); (b) explizit entfernte Preview taucht beim nächsten Tastenanschlag wieder auf; (c) Toggle Note→Todo→Note löscht die gespeicherte Preview (`linkPreviews: []` wird gesaved); (d) nur die erste URL behält ihre Preview, alle anderen werden beim nächsten Fetch verworfen.
16. **`useAsync` mountedRef-Falle** — `useAsync.js:23,59-67`: Cleanup setzt `false`, nichts setzt je `true` zurück; Effect-Re-Run (oder StrictMode) → Spinner für immer. Aktuell toter Code (kein Import) — scharfe Klinge im Küchenladen.
17. **`errorHandler.js:24` klassifiziert jeden TypeError als Netzwerkfehler** — ungenutzt aktuell, aber bei Adoption werden echte Bugs als „Internetverbindung prüfen" gemeldet.
18. **recover.html im Hauptszenario unerreichbar** — Wenn der gecachte `index.html` ein totes Bundle referenziert, stirbt der `<script type="module">` VOR React/ErrorBoundary; nichts navigiert nach `/recover.html`. Nur manuelle URL-Eingabe hilft. Fix: Inline-Error-Listener in `index.html`, der einmalig nach `/recover.html` umleitet.

## MEDIUM — Infrastruktur

19. **nginx 60 s vs 300 s Transkriptionsbudget** — `server/services/aiService.js:36` (timeout 300000), gunicorn 300 s — aber `client/nginx.conf` `/api` ohne `proxy_read_timeout` (Default 60 s) und `nginx-allinone.conf:51-52` explizit 60 s. Längere Transkription (großes Audio, langsames CPU/ARM64) → nginx 504-HTML, obwohl Server+AI erfolgreich wären.
20. **Split-Healthcheck sieht DB-Ausfall nicht** — `docker-compose.yml:76`, `docker-compose.npm.yml:76` proben `http://localhost:5000` (Root, immer 200) statt `/api/health` (503 bei Mongo-Verlust). Der All-in-One-Check macht es richtig. (AUDIT-Fix 8 dadurch in Split-Deployments wirkungslos.)
21. **Split-nginx fehlt der no-store auf `index.html`** — `client/nginx.conf:96-99` `location /` nur `try_files`; AUDIT_REPORT.md:79-80 behauptet „beide Nginx-Varianten". Heuristisches Caching nach Redeploy → tote Bundle-Requests. All-in-One (`nginx-allinone.conf:131-139`) hat es. Unvollständiger Audit-Fix.
22. **WHISPER_MODEL: Runtime-Env trifft Build-Time-Modell** — Modell wird beim Image-Build heruntergeladen (`Dockerfile.allinone:103-104`), Unraid-Template + All-in-One-Compose reichen `WHISPER_MODEL` aber als Runtime-Env. Wechsel tiny→small ohne Rebuild → Gunicorn-Worker lädt beim Boot von HuggingFace; offline → Supervisor-FATAL, alle Transkriptionen 503 bei sonst gesund wirkendem Container.
23. **Kurzes CSRF_SECRET überlebt den Start** — `entrypoint.sh` validiert nur JWT_SECRET-Länge; `csrfProtection.js:7-13` wirft erst bei Benutzung. Container grün, `/api/health` 200, aber `/api/csrf-token` 500 → Login/Register/Mutationen unmöglich mit verwirrenden 500ern.

## LOW

24. **v1-Tag-Counts inkludieren archivierte Notizen** — `v1/tags.js:53-60` ohne `isArchived`-Filter, Browser-Aggregation (`notesService.js:246+`) filtert. API-Widerspricht-App.
25. **Duplicate-Query-Params → 500 statt 400** — `?search=a&search=b` oder `?tag[$regex]=x`: `search.trim()` wirft TypeError (`notesService.js:229,236`), express-validator lässt Arrays durch. Keine Injection (Wurf passiert vor Query-Bau), aber falscher Status + Log-Noise.
26. **unlink-Fehler werden geschluckt** — `notesService.js:180-206` warnt nur; Delete-Response bleibt Erfolg; verwaiste Dateien ohne GC (Deletion-ORDER ist korrekt, das Tracking fehlt).
27. **linkPreview ohne Gesamt-Deadline** — `utils/linkPreview.js:125,202-205`: `timeout:5000` ist Socket-Idle; 1 Byte alle 4 s hält Request + Socket unbegrenzt offen. Fix: AbortController-Gesamtdeadline + Abort bei `req.close`.
28. **API-Key-Quoten-Race** — `apiKeys.js:96-102` count→save ohne Guard; parallele POSTs überschreiten 10/User (nur Selbstquota).
29. **`.env.example`-Platzhalter wird abgelehnt** — `server/.env.example:14` `your-jwt-secret-key…` matcht die Blacklist in `middleware/auth.js` (`your[-_ ]?jwt`) → Crash beim Start mit irreführender Meldung (Wert ist 65 Zeichen lang).
30. **nginx 25M vs multer 25MiB+Overhead** — `client_max_body_size 25M` zählt ganze Multipart-Body, Multer nur die Datei (26,214,400 B) → Audio knapp unter 25 MiB → rohes nginx-413-HTML statt freundlicher Server-Fehlermeldung. Fix: nginx 26M (wie `ai/app.py:8`).
31. **Toast-Timer-Reset bei jedem Parent-Render** — `Toast.jsx:5-11` mit Inline-`onClose` aus `App.jsx` in den Deps → 3-s-Timer startet neu, Toast überlebt seine Animation. (SearchBar macht's mit Ref richtig.)
32. **ConfirmDialog stellt Fokus nicht zurück** — `ConfirmDialog.jsx:27-31`: nach Schließen liegt Fokus auf `<body>`.
33. **Overlay-Klick bei Textauswahl verwirft Modal-Formulare** — Admin/Friends/Collaborate/Settings: `onClick={close}` auf Overlay ohne mousedown/up-Guard; Text im Modal selektieren und außerhalb loslassen schließt das Modal (inkl. ungespeicherm Formular). Escape fehlt dort ebenfalls (inkonsistent zu NoteModal).

## Geprüft und bewusst NICHT gemeldet (Auswahl)

- Session-Versioning, Logout-`$inc`, konstante Zeitvergleiche, OAuth-State-Cookie, erste-Admin-Race (partial unique index): korrekt.
- `/transcribe` ohne Auth ist nicht erreichbar (internes Netz/127.0.0.1-Bind).
- Upload-MIME/Pixel-Limits, temp-cleanup durch multer 2.2.0 selbst, secureFileServe-Ownership, shareNote-Validierung, 25-Image-Cap via `$expr`: korrekt.
- Service-Worker cached keine privaten Daten; recover.js löscht keine Account-Daten.
- Compose-Pfade (uploads split vs allinone), Trust-Proxy-Wiring, Workflow/Metadata-Match, Vite-outDir: konsistent.

## Empfohlene Reihenfolge

1. Nr. 1 (Datenverlust) — sofort; betrifft jeden Nutzer der `<` in Notizen nutzt.
2. Nr. 2 + 4 (CSRF-Lebenszyklus + Logout) — ein Client-Fix (Token-Clear + 403-Retry) deckt beide Trigger.
3. Nr. 3 (Modal-CSS) — 5 Zeilen CSS.
4. Nr. 5 (E-Mail-Kanonisierung) — eine Helper-Funktion, drei Call-Sites.
5. Danach Infra-Cluster Nr. 19-23 (je Einzeiler bis Kleinteilig) und der Rest nach Priorität.
