# Public demo operations

The public demo is intentionally separate from every private KeepLocal
installation:

- Vercel serves only `client/` at `https://keep-local-silk.vercel.app`;
- `client/vercel.json` rewrites same-origin `/api` and `/uploads` requests to
  `https://keeplocal-demo.zwaetschge-webui.ch`;
- `docker-compose.demo.yml` runs a restricted all-in-one backend with dedicated
  MongoDB and upload paths;
- the fixture reset worker restores the shared demo account every six hours.

Do not point the Vercel project at a private KeepLocal API.

## Vercel project

Set the Vercel project root directory to `client`. The checked-in
`client/vercel.json` defines the Vite build, output directory, proxy rewrites,
security headers, private-data cache policy, and no-store recovery assets.

Leave `VITE_API_URL` and the legacy `REACT_APP_API_URL` unset. Same-origin URLs
are required for the HttpOnly session and CSRF cookies.

Changing the backend hostname requires coordinated changes to:

- `client/vercel.json` rewrite destinations;
- demo `ALLOWED_ORIGINS`;
- demo `CLIENT_URL`;
- the reverse-proxy route and certificate.

## Deploy the isolated backend

The checked-in contract assumes the existing external network
`brian_traefik-public` and its shown Traefik labels. Adapt those host-specific
names in a private deployment override when necessary.

Use an immutable multi-architecture manifest digest:

```bash
DEMO_DIR=/mnt/user/appdata/keeplocal-demo
DEMO_ENV="$DEMO_DIR/demo.env"
install -d -m 0700 "$DEMO_DIR" "$DEMO_DIR/mongodb" "$DEMO_DIR/uploads"

export KEEPLOCAL_DEMO_IMAGE='valentin2177/keeplocal@sha256:<manifest-digest>'
export JWT_SECRET="$(openssl rand -hex 48)"
export CSRF_SECRET="$(openssl rand -hex 48)"
umask 077
printf '%s\n' \
  "KEEPLOCAL_DEMO_IMAGE=$KEEPLOCAL_DEMO_IMAGE" \
  "JWT_SECRET=$JWT_SECRET" \
  "CSRF_SECRET=$CSRF_SECRET" \
  'TRAEFIK_ENABLE=false' \
  > "$DEMO_ENV"

docker compose --env-file "$DEMO_ENV" -f docker-compose.demo.yml config
docker compose --env-file "$DEMO_ENV" -f docker-compose.demo.yml up -d
```

The first start keeps the public route disabled. Verify the container privately:

```bash
docker inspect --format '{{.State.Health.Status}}' keeplocal-demo
docker exec keeplocal-demo curl -fsS http://127.0.0.1/api/health
docker exec keeplocal-demo curl -fsS http://127.0.0.1/api/auth/providers
```

Only after those checks pass, set `TRAEFIK_ENABLE=true` in `demo.env` and
recreate:

```bash
docker compose --env-file "$DEMO_ENV" -f docker-compose.demo.yml up -d --force-recreate
curl -fsS https://keeplocal-demo.zwaetschge-webui.ch/api/health
curl -fsS https://keep-local-silk.vercel.app/api/auth/providers
```

## Verify the user path

Use a clean browser context at desktop and mobile widths:

1. Open the Vercel URL.
2. Choose **Demo ausprobieren** / **Try demo**.
3. Confirm the public-demo banner and fixture notes.
4. Confirm uploads, API keys, friends, sharing, and AI controls are absent or
   blocked.
5. Open `/recover.html`, wait for the redirect, and repeat the demo login.

The recovery HTML, JavaScript, CSS, and service worker must all be served with a
no-store policy so a broken cached app can repair itself.

## Disable or roll back

Set `TRAEFIK_ENABLE=false` and recreate the service to remove the public route
without deleting sandbox data.

For an application rollback, set `KEEPLOCAL_DEMO_IMAGE` to the previous verified
manifest digest and recreate. Do not use `down -v` or point the demo mounts at
`/mnt/user/appdata/keeplocal`; those actions risk deleting or mixing unrelated
data.

Never commit `demo.env`, cookies, JWT/CSRF secrets, OAuth credentials, or private
host configuration.
