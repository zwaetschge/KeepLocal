# Keep parity implementation

Authorized scope: all actionable suggestions in `GOOGLE_KEEP_VERGLEICH_2026-10-27.md`.
Branch: `feat/keep-parity-20261027`. No deployment requested.

## Implementation status

- [x] Title-only notes, compact masonry, readable previews, list/grid switch.
- [x] Inline quick capture and images before first save, including retry without duplication.
- [x] Server-backed combined type/tag/color/person filters and web keyboard navigation.
- [x] Optional quiet visual style, backgrounds and Android system colors.
- [x] Shared formatting representation and visual editors on both platforms.
- [x] Stable checklist IDs, nesting, item reorder, completed section and list preferences.
- [x] Android image/multi-image sharing and typed quick capture shortcuts.
- [x] Interactive note widget, filtered collection and quick capture widget.
- [x] Editable drawings and image markup on both platforms.
- [x] OCR extraction and searchable recognized text.
- [x] Personal organization of shared notes.
- [x] Retained audio recordings and playback.
- [x] Web offline write queue and quicker collaboration refresh.
- [x] Public demo origin error: reproduce and fix configuration contract.
- [x] Server/client tests, real database checks and real browser flows/screenshots.
- [x] Android MCP build including the projection upgrade: 368/368 tests, APK versionCode 33.
- [ ] Native device QA: selected device is unreachable; no other device was substituted.

## Implementation decisions

Keep existing themes, Markdown, folders, code notes, account isolation, 409 conflict
handling and Android offline queue. New note fields are additive; older clients
must not erase them when sending an older payload. Device verification uses the
selected serial `192.168.1.131:35023`; do not select another device implicitly.
Android builder project: `e20252b2-c006-4b8b-980e-586ac00e8769`, claimed by
`JEHgu70nnyRPeRJ5Z5zXC`. Use its MCP through the installed stdio server when
tools are not exposed in the active tool inventory.

## Validation evidence

- Server: 519 tests; client: 327 tests; MongoDB integration: 17 tests.
- Real browser: title-only notes, persisted visual formatting, keyboard selection,
  offline create/replay, heading/format removal, drawing-only capture, desktop
  and narrow layout. Upload retry is checked with
  an injected first-request failure.
- Server OCR, retained audio, access checks and full feature/image/audio ZIP round
  trip were exercised against real MongoDB, Tesseract and Sharp.
- Five existing client lint warnings remain; no new lint errors.
- Android: build status `built`, 368/368 tests, no skipped tests. Room schema 8
  adds only `featuresJson` and `ocrText`; no old columns removed.
- APK: `artifacts/keeplocal-1.19.0-dev-vc33.apk` in the parent workspace;
  SHA-256 `9988a9b43b49ee32d9db762a06940982b86d3d72b0de7545c3ca02b831c4539e`.
- Physical device `192.168.1.131:35023`: reconnect reports `No route to host`.

See [keep-parity.md](keep-parity.md) for user flows, synchronization limits and
the shared API contract. This branch is not deployed to the live services.

## CSRF follow-up — 2026-10-27

The reported `Ungueltiges CSRF-Token` exposed a reproducible upload gap:
multipart requests used the in-memory token without initialization or recovery.
JSON, auth and multipart requests now share a transport that initializes missing
tokens, coalesces concurrent token requests and retries a rejected CSRF request
once with the original body. Other 403 responses are never replayed. Token
responses explicitly disable caching on both the client and server.

Seven executable regression tests exercise the actual client modules against
the signed-cookie middleware. Six fail against the previous code; all seven
pass with the correction. Full checks: client 334/334, server 519/519,
production build successful, zero lint errors (five existing warnings).
A Chromium check with real HTTP cookies and multipart parsing also verifies
cookie expiry recovery, retained file bytes, concurrent recovery and no retry
on permission denial. Evidence is in the parent workspace under
`audit-evidence/csrf-fix-2026-10-27/`. The user's exact failing URL/action has
not been supplied; this local correction has not been deployed.

## Editor presentation follow-up — 2026-10-27

After feedback on the always-visible history/folder/reminder/tag fields, the
web editor now uses a compact 600px note surface with the pin beside the title
and a single row of reminder, collaboration, palette, image, archive and more
controls. Closing saves using the existing save/conflict/upload handling.
Labels and scheduled reminders appear as chips. Folder selection, label editing,
history, list options and advanced modes are available on demand. Reminder
presets use local time (tomorrow/in one week at 08:00); manual dates remain
editable. Discard is in More and clears the local draft.

Browser checks use synthetic notes: history loads on demand; Escape dismisses
only the popover and restores focus; clicking the content dismisses it without
stealing typing focus; reminder, label and folder edits reach one save request;
the PDF picker is keyboard accessible. Desktop, dark theme, 390px and 320px
screens were rendered; narrow layouts and popover bounds were checked.
Client 334/334, production build successful, lint zero errors/five existing
warnings. Evidence and the reproducible browser script:
`audit-evidence/editor-keep-2026-10-27/` in the parent workspace.
This is a local web change; no Android rebuild or live rollout was performed.


## Keep layout across designs — 2026-10-27

The user clarified that Keep's arrangement and interaction model must be the
shared foundation, with the existing designs remaining selectable. The web
shell now separates layout from themes: 64px header, hamburger-controlled
280px/80px sidebar, 720px maximum search, 600px inline composer, 240px masonry
cards, list mode and compact card/editor actions. The sidebar orders notes,
reminders, labels, label management, archive and trash; KeepLocal extras are
in More. Search discovery replaces the permanent filter dropdown row. Account,
refresh, view and settings actions are in the header; all five themes and both
surface styles are available in Settings → Design. Demo users receive the
appearance dialog without gaining account administration controls.

Card layout uses measured row spans, retaining chronological DOM order and
keyboard access. Card actions include reminder, collaboration, color, image,
archive and More; the pin is in the upper right. Selecting an image opens the
editor with the actual selected File; the hidden input stops its click bubbling
so the editor is not opened prematurely without that file. Shared popovers are
loaded with both cards and editor, dismiss on Escape/outside click and fit
narrow viewports.

Validation:

- Read-only measurements from the user's already-open Google Keep Firefox tab
  confirmed 64px header, 280px navigation and 240px cards. No Google notes were
  edited or copied into the synthetic fixtures.
- REA MCP captured the local production build with a temporary owned Chromium
  profile (`ev_23e9f5d8c9e2aafe2faeaf338db071ab4a0ac7626f9a97f1720d34075fd56c4b`).
- Client 334/334, production build succeeds, lint zero errors and five existing
  warnings. No backend contract or dependency was changed.
- Browser verification covers all ten theme/surface combinations retaining
  layout geometry, sidebar collapse, filters reaching request parameters,
  list mode, label editor, keyboard/drawer focus, image selection and discard.
- One/two/three notes with varied heights fill horizontally without overlap;
  390px and 320px layouts and menu bounds pass. Desktop, search, mobile, dark
  and Doodle screenshots are retained with reproducible scripts.
- Android Builder MCP is healthy; the selected device again returns
  `No route to host`. No native visual-parity claim, Android source change,
  alternate device, release or live rollout is included in this follow-up.

Evidence: parent workspace `audit-evidence/keep-layout-2026-10-27/`.

## Release preparation and browser update fix — 2026-10-27

User authorized the live rollout and reported requiring Ctrl+Shift+R. Navigation
now bypasses the HTTP cache, HTML is explicitly no-store on Vercel, and only
fingerprinted `/assets/` files inherit nginx's immutable cache policy. Each
production build stamps the service worker with an identity derived from its
HTML and asset content and precaches the matching JS/CSS/font cohort. Failed
precache prevents a partially usable worker from activating. Update listeners
are attached before update checks, and an already-waiting worker is recovered
when the update hook mounts. Running editors are not force-reloaded.

Validation: client 338/338, server 519/519, real MongoDB integration 18/18,
build successful, lint zero errors
and five existing warnings. An HTTP-cache-enabled Chromium upgrade test uses
the previous v8 worker, migrates to the new worker without hard reload, loads a
third build with ordinary reload, then loads that asset cohort offline. Both a
local draft and an IndexedDB pending operation survive. Evidence:
`audit-evidence/live-2026-10-27/` in the parent workspace.

The live Docker proxy currently denies inspection of `keeplocal` and
`keeplocal-demo` with HTTP 403. Rollout requires the project/container access
assignment to be restored; no production container or appdata has been changed
by this preparation. New frontend fields require the matching backend, so the
candidate is kept on its feature branch until coordinated rollout is possible.

Release preflight also updates dependencies within their declared version ranges
(server/client audits: zero vulnerabilities), installs the required OCR runtime
in the integration job, and updates source/image browser tests for inline
capture, rich text, personal organization and on-demand menus. Browser checks
found and fixed missing collaborator media controls, relevance ordering in the
personal-note aggregation, and search highlights across rich formatting.
