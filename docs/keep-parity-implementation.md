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
