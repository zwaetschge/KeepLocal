# Docker builds and operations

KeepLocal supports a split stack for development and conventional hosts, plus
an all-in-one image for Unraid and simple self-hosting. Both contracts build for
AMD64 and ARM64.

## Choose a deployment

| Contract | Components | Persistent paths |
| --- | --- | --- |
| `docker-compose.yml` | MongoDB, AI, API, client Nginx | `mongodb_data`, `uploads_data` mounted at `/app/uploads` in the API container |
| `docker-compose.npm.yml` | Split stack plus an external `npm-network` | Same as the standard split stack |
| `docker-compose.allinone.yml` | One container with all services | `mongodb_data` at `/data/db`, `uploads_data` at `/app/server/uploads` |
| `docker-compose.demo.yml` | Restricted public sandbox | Dedicated host bind mounts; never normal production paths |

Do not switch between split and all-in-one layouts until both MongoDB and upload
paths have been backed up and mapped deliberately.

## Build the split stack

Create `.env` from `.env.example`, replace `JWT_SECRET`, and then run:

```bash
docker compose config
./build-images.sh
docker compose up -d
docker compose ps
```

`build-images.sh` is a checked wrapper around `docker compose build`; it builds
the AI, server, and client images used by the local stack. Set
`WHISPER_MODEL=tiny` before the command when a smaller model is preferable.

## Build the all-in-one image

```bash
./build-allinone.sh
```

Supported overrides:

```bash
DOCKER_IMAGE=example/keeplocal \
VERSION=dev \
WHISPER_MODEL=tiny \
PLATFORM=linux/amd64 \
NO_CACHE=false \
./build-allinone.sh
```

The model is downloaded during the image build. Larger models make builds,
pulls, and container startup verification substantially heavier.

## Published tags

The `Docker Build and Push` GitHub workflow publishes
`valentin2177/keeplocal` after changes reach `main`:

- immutable `YYYY-MM-DD-<7-character-sha>` tag for every main build;
- `main` and `latest` for the current stable main build;
- full, minor, and major tags for stable `vMAJOR.MINOR.PATCH` releases;
- only the full version for prereleases.

The workflow rejects invalid manual versions, builds a multi-architecture
manifest, then starts and health-checks the published AMD64 and ARM64 images.
Use the immutable date/SHA tag or manifest digest for production rollback.

## Health verification

For the split stack:

```bash
docker compose ps
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/
```

For the all-in-one stack:

```bash
docker compose -f docker-compose.allinone.yml ps
curl -fsS http://localhost:3000/api/health
docker exec keeplocal-allinone curl -fsS http://127.0.0.1:5001/health
```

The API health endpoint returns HTTP 503 when MongoDB is disconnected.
`/api/health/live` answers as long as the process runs; `/api/health/ready`
additionally performs a real database ping, checks that the uploads directory is
writable and (optionally) probes the AI service — the compose healthchecks use the
readiness endpoint.

The readiness payload is trimmed for anonymous callers: `database.detail` (driver
error text), `uploads.detail` (absolute server path) and `ai.detail` are only
included when `HEALTH_DETAILS=true` (the default outside production). Status
codes are identical either way, so healthchecks and load balancers keep working.
The uploads write probe and the AI probe are cached for `HEALTH_PROBE_TTL_MS`
(default 30000) so a healthcheck storm cannot be turned into I/O amplification.

## Backup

### Recommended: the built-in backup script

`server/scripts/backup.js` writes one recovery point per run — every collection
as type-preserving NDJSON, the uploads, and a SHA-256 manifest — and restores it.
It needs no `mongodump`, so it also works inside the split server image.

```bash
# One backup (all-in-one container)
docker compose -f docker-compose.allinone.yml exec keeplocal \
  node /app/server/scripts/backup.js

# Split deployment: run it in the server container
MONGODB_URI=mongodb://mongodb:27017/keeplocal \
  docker compose -f docker-compose.yml exec server node scripts/backup.js --keep 7

# List and restore (restore is destructive and requires --force)
docker compose -f docker-compose.yml exec server node scripts/backup.js --list
docker compose -f docker-compose.yml exec server \
  node scripts/backup.js --restore backups/keeplocal-20260911-221925 --force
```

Environment: `MONGODB_URI` (required), `BACKUP_DIR` (default `server/backups`),
`UPLOADS_DIR` (default `server/uploads`). Retention defaults to the newest seven
backups. Schedule it with your usual cron/host tooling and **test the restore
before** you need it — the manifest checksums are verified on restore.

### Alternative: filesystem or mongodump copies

Back up MongoDB and uploads as one recovery point. The safest filesystem copy
for the all-in-one bind-mount layout is made while the container is stopped:

```bash
docker stop KeepLocal
cp -a /path/to/keeplocal/mongodb /path/to/backups/keeplocal-mongodb
cp -a /path/to/keeplocal/uploads /path/to/backups/keeplocal-uploads
docker start KeepLocal
```

For named volumes, use your platform's volume backup tooling or `mongodump` for
MongoDB plus a separate archive of `uploads_data`. Verify that the backup can be
listed and restored before upgrading.

Split deployment (running services, no downtime). The MongoDB container ships
the database tools, so both directions run through `docker exec`:

```bash
# Database
docker exec keeplocal-mongodb mongodump --db keeplocal --archive --gzip > keeplocal-$(date +%F).archive.gz
# Uploads (named volume -> tarball)
docker run --rm -v uploads_data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/keeplocal-uploads-$(date +%F).tgz -C /data .
```

Restore into a stopped stack (verify the archive restores before you need it):

```bash
docker compose -f docker-compose.yml stop server client
docker exec -i keeplocal-mongodb mongorestore --archive --gzip --drop < keeplocal-$(date +%F).archive.gz
docker run --rm -v uploads_data:/data -v "$PWD:/backup" alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/keeplocal-uploads-$(date +%F).tgz -C /data"
docker compose -f docker-compose.yml up -d
```

### Email canonicalization migration (pre-2026-08 accounts)

Accounts created through the admin console or OAuth before 2026-08 may store
non-canonical email forms (dotted Gmail, `+tags`) that can never log in. Check
and repair them with the one-off migration script — dry run first:

```bash
docker exec -it keeplocal-server sh -c \
  'MONGODB_URI=$MONGODB_URI node scripts/normalize-emails.js'          # dry run
docker exec -it keeplocal-server sh -c \
  'MONGODB_URI=$MONGODB_URI node scripts/normalize-emails.js --write'  # apply
```

Collisions (two accounts canonicalizing to the same address) are reported, never
rewritten automatically.

## Update

1. Record the currently running immutable tag or digest.
2. Back up MongoDB and uploads.
3. Pull or build the desired image.
4. Run `docker compose config`.
5. Recreate without `-v`.
6. Verify API health, login, note reads, and one authorized image.

The checked-in all-in-one Compose file builds locally. If production should
pull a published image instead, set its `image:` to the chosen immutable tag and
remove the `build:` block in the host-specific Compose file before running
`docker compose up -d --force-recreate`. Confirm with `docker inspect` that the
container uses the requested digest rather than a locally built tag.

## Rollback

Restore the previous immutable image reference and recreate the service. Restore
data only if an application migration changed it or the post-update verification
shows corruption; an image rollback and a data rollback are separate decisions.

Never use `docker compose down -v` for an update or rollback. It deletes named
volumes.

## CI secrets

The publication workflow requires repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Application secrets such as `JWT_SECRET`, `CSRF_SECRET`, and OAuth client
secrets are runtime configuration. They are not Docker build arguments and must
not be baked into an image.
