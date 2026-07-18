# Nginx Proxy Manager

`docker-compose.npm.yml` keeps MongoDB, Whisper, and the API on internal
networks. Only the KeepLocal client Nginx joins the external Nginx Proxy Manager
network. NPM therefore needs one proxy host, not separate `/api` or `/uploads`
hosts.

## 1. Prepare the external network

The checked-in Compose file expects an existing network named `npm-network`:

```bash
docker network create npm-network
```

If NPM already uses another external network, replace `npm-network` in the
Compose file with that exact name. Do not attach MongoDB, the AI service, or the
API container directly to the external proxy network.

## 2. Configure KeepLocal

```bash
cp .env.example .env
openssl rand -hex 48
openssl rand -hex 48
```

Put the two independent values and the real public origin in `.env`:

```dotenv
JWT_SECRET=<first-random-value>
CSRF_SECRET=<second-random-value>
ALLOWED_ORIGINS=https://notes.example.com
CLIENT_URL=https://notes.example.com
COOKIE_SECURE=true
WHISPER_MODEL=base
```

`ALLOWED_ORIGINS` values are exact origins: scheme, host, and optional port,
without a trailing path. Wildcards are rejected in production.

The NPM route has two proxies before Express (NPM and the client Nginx), so this
deployment sets `TRUST_PROXY=2`. Do not increase it unless another trusted proxy
is actually added to the path.

## 3. Start the stack

```bash
docker compose -f docker-compose.npm.yml config
docker compose -f docker-compose.npm.yml up -d --build
docker compose -f docker-compose.npm.yml ps
```

The client service has no host port. NPM reaches it by container name on the
shared Docker network.

## 4. Create the NPM proxy host

Use these values in **Hosts → Proxy Hosts → Add Proxy Host**:

| NPM field | Value |
| --- | --- |
| Domain Names | `notes.example.com` |
| Scheme | `http` |
| Forward Hostname / IP | `keeplocal-client` |
| Forward Port | `80` |
| Cache Assets | Off |
| Block Common Exploits | On |
| Websockets Support | Optional; KeepLocal does not currently require it |

On the SSL tab, request or select a certificate, enable **Force SSL**, and use
HTTP/2. HSTS is appropriate only after HTTPS is confirmed working for the real
domain.

No advanced custom Nginx snippet is required. The client container already
routes `/api` and `/uploads` internally, protects private uploads from caching,
serves the PWA, and applies the application security headers.

## 5. Verify

```bash
curl -fsS https://notes.example.com/api/health
curl -I https://notes.example.com/service-worker.js
curl -I https://notes.example.com/recover.html
```

Expected results:

- `/api/health` returns `status: ok` and `database: connected`;
- the service worker and recovery files include `Cache-Control: no-store` or an
  equivalent `no-cache, no-store, must-revalidate` policy;
- the login page loads without CORS errors;
- the browser receives a Secure, HttpOnly session cookie after login.

## Troubleshooting

### 502 Bad Gateway

Confirm that NPM and `keeplocal-client` share the same Docker network:

```bash
docker network inspect npm-network
docker compose -f docker-compose.npm.yml ps
docker compose -f docker-compose.npm.yml logs client
```

The NPM forward host is `keeplocal-client`, not `localhost` and not the API
container.

### Origin is not allowed

Set both `ALLOWED_ORIGINS` and `CLIENT_URL` to the exact HTTPS origin, then
recreate the server:

```bash
docker compose -f docker-compose.npm.yml up -d --force-recreate server
```

### Login loops or old UI after an update

Open `https://notes.example.com/recover.html`. The standalone page unregisters
old KeepLocal workers and caches without deleting account cookies or notes.

### Every user appears to have the same IP

Ensure the checked-in `TRUST_PROXY=2` is still present and NPM forwards the
standard `X-Forwarded-For` and `X-Forwarded-Proto` headers. Do not expose the API
container directly as a workaround.
