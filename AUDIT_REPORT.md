# KeepLocal Audit Report

Date: 2026-07-16
Base: `origin/main` at `3d9c7aa`
Audit branch: `codex/comprehensive-audit-20260716`

## Scope

The review covered browser authentication, OAuth, CSRF, API keys, note and friend
authorization, uploads, link previews, AI transcription, MongoDB consistency,
service-worker caching, React state and forms, accessibility, build tooling,
Docker/Compose, Nginx, Supervisor, and dependency vulnerabilities.

## Critical and high-impact fixes

1. Private images bypassed authorization through Nginx aliases. Both Nginx variants
   now proxy uploads through authenticated Express file serving, and the service
   worker never caches private uploads.
2. Login could enter a `/login` reload loop, exhaust the rate limit, then parse an
   HTML/429 body as JSON. Anonymous 401 responses no longer redirect or trigger
   logout, and all auth responses tolerate non-JSON proxy errors.
3. JWTs were persisted in browser storage and accepted as bearer tokens. Sessions
   now use only the `kl_session` HttpOnly cookie, include a revocable session
   version, and are invalidated on logout.
4. OAuth exposed or trusted unsafe state: tokens are no longer placed in URLs,
   callbacks validate a constant-time state cookie, account linking requires a
   verified email, registration policy is enforced, and redirects use only
   `CLIENT_URL` or an allowlisted origin.
5. Link previews allowed SSRF and DNS-rebinding paths. Private, loopback, reserved,
   multicast, mapped IPv4/IPv6, embedded credentials, unsafe redirects, oversized
   responses, and protocol changes are rejected; DNS resolution is pinned.
6. Concurrent first registrations could create multiple admins. A unique partial
   bootstrap-admin index now elects only one account, and HTTP starts only after
   all MongoDB indexes are ready.
7. Split deployments mounted uploads at `/app/server/uploads` while the server wrote
   to `/app/uploads`. Both Compose variants now persist the directory actually used.
8. Express listened before MongoDB connected and health checks ignored DB loss.
   Startup now awaits MongoDB and indexes; health returns 503 while disconnected.

## Additional fixes

- Replaced archived `csurf` behavior with signed HMAC CSRF tokens and constant-time
  comparisons; all browser mutations, including login and logout, are protected.
- Removed credential values from validation responses, bounded passwords and request
  bodies, equalized unknown-user password timing, and made duplicate auth failures
  generic.
- Hardened production CORS, proxy-hop configuration, cookie security detection,
  rate-limit responses, API 404s, and production error redaction.
- Enforced matching declared/actual image MIME types, image/audio signatures, fully
  random stored filenames, pixel limits, upload counts atomically in MongoDB, temp
  cleanup, and ownership before multipart parsing.
- Corrected DB/file deletion order, standalone-Mongo admin deletion, pagination and
  tag counts, API-key limits, and note validation shared by browser and v1 APIs.
- Made friend acceptance/removal atomic and retry-safe; bounded searches and IDs and
  removed email disclosure from ordinary search results.
- Prevented stale search responses, stale counts, double mutations, premature modal
  close, microphone leaks, unbounded form values, and ignored save/delete failures.
- Migrated the frontend from deprecated `react-scripts` to Vite 8 and ESLint 9 with
  lockfiles and explicit development/production modes; removed the unused Axios
  browser dependency.
- Made service-worker install, activation, and cache writes lifecycle-safe; private
  responses remain network-only. Added a strict Nginx CSP and self-hosted all fonts
  so the client no longer depends on runtime requests to Google Fonts.
- Improved keyboard focus, reduced-motion behavior, responsive auth scrolling,
  Doodle theme consistency, and desktop/mobile auth contrast.
- Added missing AI service/networking to the Nginx Proxy Manager deployment, isolated
  backend networks, passed all auth/OAuth variables through, and dropped root for the
  split server/AI and all-in-one AI processes.
- Fixed the AI Dockerfile package syntax and aligned its preloaded model with the
  configured model. Updated Flask, Faster-Whisper, and Gunicorn to secure releases.

## Verification

- Server: 37/37 Node tests passed.
- Client: 22/22 Node tests passed.
- AI: 4/4 Flask route tests passed; Gunicorn configuration loaded successfully.
- ESLint: no findings.
- Vite production build: 85 modules, 281.40 kB JavaScript and 127.04 kB CSS,
  successful.
- `npm audit`: 0 known vulnerabilities in server and client trees.
- `pip-audit`: 0 known vulnerabilities in the Python 3.10/Ubuntu-resolved tree.
- All three Compose variants pass `docker compose config --quiet`.
- JavaScript, Python, shell, and Git whitespace syntax checks passed.
- Chromium smoke tests passed at 1440x900 and 390x844 without clipping or overlap.

The environment's Docker policy rejects image build requests with HTTP 403, so a
fresh Docker image build could not be completed here. This is the remaining build
verification gap; it is not a Dockerfile parser or application test failure.

## Deployment and migration notes

1. Back up MongoDB and uploads before rollout.
2. Split-container users must inspect and copy any existing `/app/uploads` data from
   the old server container before recreating it; the previous volume mount pointed
   at the wrong directory.
3. Existing browser sessions intentionally require one new login because legacy
   bearer/local-storage tokens and the old `token` cookie are no longer accepted.
4. Set `CLIENT_URL` and explicit `ALLOWED_ORIGINS` to the public HTTPS origin. Keep
   `TRUST_PROXY=1` unless exactly two trusted proxies sit in front of Express.
5. Startup may expose pre-existing duplicate OAuth identities because indexes are now
   awaited. Resolve duplicates rather than disabling the index.
6. The running production container was built from a source state not present on
   `origin/main`. Do not deploy this branch over it without a backup and staging
   migration test; this audit branch has not changed the live container.
