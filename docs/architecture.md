# Current architecture

This document describes the current codebase. Older one-time refactoring reports
were removed because their file lists, authentication examples, and pending-work
sections no longer matched the application.

## Request path

```text
Browser
  -> client Nginx or Vercel
      -> /api and /uploads: Express API
      -> app assets: React/Vite build
Express
  -> MongoDB: accounts, settings, notes, API keys
  -> AI service: optional audio transcription
```

The all-in-one image runs MongoDB, Express, Gunicorn/faster-whisper, and Nginx
under Supervisor. The split stack runs each responsibility in a separate
container.

## Client

`client/` contains React 18 components, Context providers, focused hooks, a
Fetch-based API layer, local translations, theme styles, and Node regression
tests. Vite 8 writes the production bundle to `client/build/`.

Authentication state comes from `/api/auth/me`; browser JavaScript never stores
the session JWT. State-changing browser requests obtain and send a signed CSRF
token. The service worker caches only public application assets and uses a
network-first navigation strategy.

`client/public/recover.html` is deliberately independent of React. It can remove
old KeepLocal service workers/caches and display preferences even when the main
bundle cannot start.

## API

`server/server.js` establishes process-wide security middleware and mounts:

- browser authentication, notes, friends, admin, and API-key management routes;
- authenticated private upload delivery;
- Swagger UI and the OpenAPI JSON document;
- API-key authenticated external `/api/v1` routes;
- a MongoDB-aware health endpoint.

Route modules delegate note and admin business logic to services. MongoDB model
indexes are initialized before the HTTP port opens, preventing bootstrap races
and index-dependent writes during startup.

## Authentication and authorization

- The first empty-database setup creates one bootstrap administrator.
- Successful login sets a revocable JWT in an HttpOnly, SameSite cookie.
- The server issues signed HMAC CSRF tokens for browser mutations.
- Every note and upload access checks ownership or current collaboration access.
- API v1 uses separately managed API keys rather than browser cookies or bearer
  JWTs.
- OAuth redirect targets come from configured/allowed client origins, not an
  arbitrary Host header.

## Data

MongoDB stores users, notes, system settings, and API keys. Upload bytes live on
the filesystem and note documents contain their randomized server filenames.
Deleting users or notes removes associated database relationships and authorized
upload files in a controlled order.

MongoDB and uploads must be persisted and backed up separately. See
[docker.md](docker.md) for deployment-specific paths.

## AI

`ai/` is a small Flask application served by Gunicorn. It validates language and
response bounds, uses faster-whisper on CPU with integer computation, and is
reachable only from the internal application network. Model weights are
downloaded during image build for predictable startup.

## Deployment contracts

- `docker-compose.yml`: split local/self-hosted stack;
- `docker-compose.npm.yml`: split stack behind Nginx Proxy Manager;
- `docker-compose.allinone.yml`: locally built all-in-one stack;
- `docker-compose.demo.yml`: isolated public demo;
- `Dockerfile.allinone`: published AMD64/ARM64 image;
- `unraid-template.xml`: canonical Unraid template;
- `client/vercel.json`: public demo frontend and proxy.

These files are covered by deployment-contract tests in `server/tests/` and
client deployment tests in `client/tests/`.

## Security baseline

The current security findings, fixes, migration implications, and verification
counts are maintained in [AUDIT_REPORT.md](../AUDIT_REPORT.md). Historical
reports that discussed resolved vulnerabilities as open issues remain available
through Git history only.
