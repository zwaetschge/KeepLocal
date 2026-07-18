# CachyOS development and testing

CachyOS is Arch-based. The most reproducible way to run KeepLocal is Docker
Compose; local Node development can reuse a MongoDB container.

## Docker installation

```bash
sudo pacman -Syu
sudo pacman -S docker docker-compose openssl git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Log out and back in after changing the group membership. Confirm that Compose v2
is available:

```bash
docker version
docker compose version
```

## Run KeepLocal

```bash
git clone https://github.com/zwaetschge/KeepLocal.git
cd KeepLocal
cp .env.example .env
openssl rand -hex 48
```

Replace `JWT_SECRET` in `.env`, then run:

```bash
docker compose config
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:3000/api/health
```

Open <http://localhost:3000>. Logs are available with
`docker compose logs -f`.

## Local Node development

Install Node.js 22 with the version manager or package source you trust. Keep
MongoDB isolated in Docker:

```bash
docker run -d --name keeplocal-dev-mongodb -p 27017:27017 mongo:7-jammy
```

API terminal:

```bash
cd server
npm ci
JWT_SECRET="$(openssl rand -hex 48)" \
MONGODB_URI="mongodb://localhost:27017/keeplocal" \
ALLOWED_ORIGINS="http://localhost:3000" \
npm run dev
```

Client terminal:

```bash
cd client
npm ci
npm run dev
```

The Vite client runs on port 3000 and proxies API/upload requests to port 5000.

## Run checks

```bash
(cd server && npm test)
(cd client && npm test && npm run lint && npm run build)
(cd ai && python3 -m unittest test_app.py)
```

The AI unit tests replace the model with a fake and do not download Whisper
weights.

## Firewall

For local-only development, bind access to the machine and do not open MongoDB
or the API port publicly. If another LAN device needs the web UI, allow only the
chosen frontend port through the active firewall and add that exact origin to
`ALLOWED_ORIGINS`.

## Troubleshooting

### Docker permission denied

Verify the new login session has the `docker` group:

```bash
id
systemctl status docker
```

Do not make the Docker socket world-writable.

### Port 3000 is occupied

Change only the client host mapping in `docker-compose.yml`, for example
`8080:80`, then update `ALLOWED_ORIGINS` and `CLIENT_URL` to
`http://localhost:8080`.

### Stale browser bundle

Open `/recover.html` on the KeepLocal origin. The page bypasses the React bundle
and removes old KeepLocal caches without deleting notes.

### Destructive reset

`docker compose down -v` deletes MongoDB and uploads. Use it only when an
intentional full reset is required and a verified backup exists.
