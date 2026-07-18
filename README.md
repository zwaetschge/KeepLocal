# KeepLocal

KeepLocal is a self-hosted, multi-user notes application inspired by Google
Keep. It combines notes, checklists, tags, colors, archives, private image
uploads, collaboration, API access, and optional local Whisper transcription in
a responsive progressive web app.

## Try the public demo

[Open KeepLocal](https://keep-local-silk.vercel.app/) and choose **Try demo** /
**Demo ausprobieren**. The demo needs no account or shared password.

The public sandbox is isolated from the maintainer's private KeepLocal data and
resets every six hours. Do not enter personal or confidential information.
Uploads, transcription, API keys, link previews, friends, and sharing are
disabled there.

If a browser is still running an old cached release, open the independent
[safe-update page](https://keep-local-silk.vercel.app/recover.html). It removes
only KeepLocal's service worker, app caches, and local display preferences;
account cookies and server-side notes are not changed.

## Screenshots

Each persistent theme is shown with the same representative notes on desktop
and mobile.

### Light

<p align="center">
  <img src="assets/screenshots/keeplocal-light-desktop.png" width="74%" alt="KeepLocal Light theme on desktop" />
  <img src="assets/screenshots/keeplocal-light-mobile.png" width="21%" alt="KeepLocal Light theme on mobile" />
</p>

### Dark

<p align="center">
  <img src="assets/screenshots/keeplocal-dark-desktop.png" width="74%" alt="KeepLocal Dark theme on desktop" />
  <img src="assets/screenshots/keeplocal-dark-mobile.png" width="21%" alt="KeepLocal Dark theme on mobile" />
</p>

### OLED

<p align="center">
  <img src="assets/screenshots/keeplocal-oled-desktop.png" width="74%" alt="KeepLocal OLED theme on desktop" />
  <img src="assets/screenshots/keeplocal-oled-mobile.png" width="21%" alt="KeepLocal OLED theme on mobile" />
</p>

### E-Ink

<p align="center">
  <img src="assets/screenshots/keeplocal-eink-desktop.png" width="74%" alt="KeepLocal E-Ink theme on desktop" />
  <img src="assets/screenshots/keeplocal-eink-mobile.png" width="21%" alt="KeepLocal E-Ink theme on mobile" />
</p>

### Doodle

<p align="center">
  <img src="assets/screenshots/keeplocal-doodle-desktop.png" width="74%" alt="KeepLocal Doodle theme on desktop" />
  <img src="assets/screenshots/keeplocal-doodle-mobile.png" width="21%" alt="KeepLocal Doodle theme on mobile" />
</p>

## Current capabilities

- Notes and checklists with colors, tags, pinning, archives, search, and
  pagination
- Private image uploads and optional local audio transcription
- Friend requests and shared-note collaboration
- English and German interfaces with Light, Dark, OLED, E-Ink, and Doodle
  themes
- Responsive desktop/mobile layout and installable PWA
- Admin-managed registration and user administration
- HttpOnly cookie sessions, signed CSRF tokens, explicit CORS origins, rate
  limits, input validation, and authenticated upload delivery
- Swagger/OpenAPI documentation and API-key authenticated `/api/v1` endpoints
- Split-container and all-in-one Docker deployments for AMD64 and ARM64

## Quick start: Docker Compose

Requirements: Docker Engine with Docker Compose v2 and `openssl`.

```bash
git clone https://github.com/zwaetschge/KeepLocal.git
cd KeepLocal
cp .env.example .env
openssl rand -hex 48
```

Replace `JWT_SECRET` in `.env` with the generated value. For a separate CSRF
signing key, generate another value and set `CSRF_SECRET` too. Then validate and
start the four-service stack:

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

Open <http://localhost:3000>. On an empty database, the setup screen creates
the single bootstrap administrator. Later registrations follow the policy set
in the admin console.

Useful commands:

```bash
docker compose logs -f
docker compose restart
docker compose down
```

`docker compose down -v` permanently removes the database and uploaded files.
Do not run it as an update or troubleshooting step.

## Deployment choices

| Target | Contract | Notes |
| --- | --- | --- |
| Standard Docker | `docker-compose.yml` | MongoDB, Whisper, API, and web client as separate services |
| Nginx Proxy Manager | `docker-compose.npm.yml` | Same split stack; only the client joins the external proxy network |
| All-in-one / Unraid | `Dockerfile.allinone`, `docker-compose.allinone.yml` | MongoDB, Whisper, API, and Nginx in one image |
| Public sandbox | `client/vercel.json`, `docker-compose.demo.yml` | Vercel client plus an isolated, restricted backend |

The published all-in-one image is `valentin2177/keeplocal`. GitHub Actions
builds and smoke-tests both AMD64 and ARM64 variants before a `main` release is
considered complete.

Detailed guides:

- [Docker builds, image tags, updates, and rollback](docs/docker.md)
- [Nginx Proxy Manager](docs/nginx-proxy-manager.md)
- [Unraid](docs/unraid.md)
- [CachyOS development and testing](docs/cachyos.md)
- [Public demo operations](docs/public-demo.md)
- [Current architecture](docs/architecture.md)
- [Security audit and migration notes](AUDIT_REPORT.md)

## Persistent data and upgrades

KeepLocal has two independent persistent data sets:

- MongoDB (`mongodb_data` or `/data/db`)
- Private uploads (`uploads_data`, `/app/uploads` in the split server, or
  `/app/server/uploads` in the all-in-one image)

Back up both before changing images or deployment layouts. Pull or build the
new image, recreate the services without deleting volumes, verify
`/api/health`, and keep the previous immutable image tag available for rollback.
The exact procedure is in [docs/docker.md](docs/docker.md).

## Local development

Use Node.js 22 and MongoDB 7. A disposable local MongoDB can run in Docker:

```bash
docker run -d --name keeplocal-dev-mongodb -p 27017:27017 mongo:7-jammy
```

Start the API from `server/`:

```bash
cd server
npm ci
JWT_SECRET="$(openssl rand -hex 48)" \
MONGODB_URI="mongodb://localhost:27017/keeplocal" \
ALLOWED_ORIGINS="http://localhost:3000" \
npm run dev
```

In another terminal, start Vite from `client/`:

```bash
cd client
npm ci
npm run dev
```

Vite serves <http://localhost:3000> and proxies `/api` and `/uploads` to
<http://localhost:5000>.

## Verification

```bash
(cd server && npm test)
(cd client && npm test && npm run lint && npm run build)
(cd ai && python3 -m unittest test_app.py)

docker compose -f docker-compose.yml config
docker compose -f docker-compose.npm.yml config
docker compose -f docker-compose.allinone.yml config
```

The client uses Vite's `client/build/` output. The AI service's Python packages
are installed from `ai/requirements.txt`.

## API

When the API is running, interactive documentation is available at
`/api/docs`, and the OpenAPI document is available at `/api/docs.json`.

- Browser routes use the HttpOnly session cookie and a signed CSRF token.
- External `/api/v1` routes use API keys and do not accept browser bearer
  tokens.
- Private `/uploads` requests require an authenticated user with access to the
  owning note.

## Important environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `MONGODB_URI` | MongoDB connection string | Deployment-specific |
| `JWT_SECRET` | Required session signing key, minimum 32 characters | None |
| `CSRF_SECRET` | Optional independent CSRF signing key | `JWT_SECRET` |
| `ALLOWED_ORIGINS` | Exact comma-separated browser origins | `http://localhost:3000` |
| `CLIENT_URL` | Explicit frontend origin for OAuth redirects | First allowed origin |
| `COOKIE_SECURE` | Optional `true`/`false` override | Detected from HTTPS |
| `TRUST_PROXY` | Trusted reverse-proxy hop count | `1` standard / `2` NPM and public demo |
| `WHISPER_MODEL` | Bundled transcription model | `base` split / `tiny` all-in-one |
| `GOOGLE_*`, `GITHUB_*` | Optional OAuth credentials and callbacks | Disabled when empty |

Production rejects wildcard CORS origins. Never commit `.env`, tokens, OAuth
secrets, database dumps, or uploaded user files.

## Repository layout

```text
client/                 React 18, Vite 8, Nginx, PWA, regression tests
server/                 Express API, MongoDB models, services, security tests
ai/                     Flask/Gunicorn faster-whisper service
assets/screenshots/     README desktop and mobile captures
docs/                   Current deployment and architecture guides
unraid/                 Unraid template notes
.github/                Multi-architecture Docker publication workflow
docker-compose*.yml     Supported runtime contracts
Dockerfile.allinone     Published all-in-one image
unraid-template.xml     Canonical Unraid container template
```

Historical implementation reports were removed from the working tree because
they described superseded token storage, CSRF middleware, file paths, and open
findings as if they were current. Their original text remains available in Git
history; the current security baseline is documented in `AUDIT_REPORT.md`.

## Contributing

Create a focused branch, include tests for behavior changes, run the relevant
verification commands above, and open a pull request against `main`. Do not add
generated builds, local environment files, screenshots containing private
notes, or runtime uploads.
