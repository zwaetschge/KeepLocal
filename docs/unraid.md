# Unraid installation

The supported Unraid path is the published all-in-one image. The old three
container templates were removed because they referenced unpublished local
images and attempted to configure Vite at runtime.

## Install from the canonical template

In the Unraid Docker UI, add a container from this template URL:

```text
https://raw.githubusercontent.com/zwaetschge/KeepLocal/main/unraid-template.xml
```

The template uses `valentin2177/keeplocal:latest` and exposes container port 80
as host port 3000 by default.

Before applying it:

1. Generate a unique secret with `openssl rand -hex 48` and enter it as
   `JWT_SECRET`.
2. Set `ALLOWED_ORIGINS` and `CLIENT_URL` to the exact URL used in the browser,
   for example `http://192.168.1.20:3000`.
3. Confirm both persistent paths:
   - `/mnt/user/appdata/keeplocal/mongodb` → `/data/db`
   - `/mnt/user/appdata/keeplocal/uploads` → `/app/server/uploads`
4. Keep `TRUST_PROXY=1` for direct LAN access.

Open `http://UNRAID-IP:3000`. The first empty-database visit shows the bootstrap
administrator setup.

## Reverse proxy and HTTPS

For `https://notes.example.com`:

- set `ALLOWED_ORIGINS=https://notes.example.com`;
- set `CLIENT_URL=https://notes.example.com`;
- leave `COOKIE_SECURE` empty for automatic detection or set it to `true` only
  after HTTPS works;
- set `TRUST_PROXY=2` because the request passes through the external proxy and
  the all-in-one container's Nginx before Express.

Proxy the public hostname to Unraid port 3000. Do not publish MongoDB, the API
port, or the AI port separately.

## Data and backup

Notes/account metadata and uploaded files are separate. Back up both appdata
directories as one recovery point.

For a consistent filesystem copy:

```bash
docker stop KeepLocal
mkdir -p /mnt/user/backups/keeplocal
cp -a /mnt/user/appdata/keeplocal/mongodb /mnt/user/backups/keeplocal/
cp -a /mnt/user/appdata/keeplocal/uploads /mnt/user/backups/keeplocal/
docker start KeepLocal
```

Unraid's appdata backup tooling is also suitable when it captures both paths
while the container is stopped. Periodically test that backups are readable.

## Update and rollback

Before **Force Update**, record the current image ID/digest and create a backup.
After updating, wait for the health check and verify:

```bash
docker inspect --format '{{.State.Health.Status}}' KeepLocal
curl -fsS http://127.0.0.1:3000/api/health
```

For reproducible production deployments, replace `latest` with an immutable
`YYYY-MM-DD-<sha>` Docker Hub tag. Roll back by restoring the previous image
reference and recreating the container without deleting appdata.

## Configuration reference

| Setting | Required | Guidance |
| --- | --- | --- |
| `JWT_SECRET` | Yes | At least 32 random characters; no default is provided |
| `CSRF_SECRET` | No | Independent 32+ character key; falls back to `JWT_SECRET` |
| `ALLOWED_ORIGINS` | Yes | Exact browser origins, comma-separated |
| `CLIENT_URL` | Yes | Exact browser origin used for redirects |
| `COOKIE_SECURE` | No | Empty for auto-detection; `true` for confirmed HTTPS |
| `TRUST_PROXY` | No | `1` direct, `2` behind one external reverse proxy |
| `WHISPER_MODEL` | No | `tiny` is the all-in-one default |
| `JWT_EXPIRES_IN` | No | Default `7d` |

## Troubleshooting

### Container exits immediately

Check `docker logs KeepLocal`. Startup rejects a missing or short `JWT_SECRET`.
The entrypoint also repairs the expected ownership of its mounted database and
upload directories.

### Browser shows an old release

Open `http://UNRAID-IP:3000/recover.html` (or the HTTPS equivalent). Recovery
clears only KeepLocal web caches and display preferences.

### Health is degraded

```bash
docker logs KeepLocal
docker exec KeepLocal tail -n 100 /var/log/mongodb/mongod.log
docker exec KeepLocal curl -fsS http://127.0.0.1:5001/health
```

Do not delete the database to fix a forgotten password. KeepLocal currently has
no self-service password reset; use another administrator where available or
restore a known-good backup.

## Included runtime

The current all-in-one image contains MongoDB 7, Node.js 22, Nginx, Supervisor,
Python 3, Gunicorn, FFmpeg, and faster-whisper.
