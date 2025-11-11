# Nginx Proxy Manager - Quick Start

**Schnellanleitung für KeepLocal mit Nginx Proxy Manager**

## TL;DR - Die wichtigsten Schritte

### 1. Netzwerk erstellen
```bash
docker network create npm-network
```

### 2. .env Datei erstellen
```bash
cp .env.example .env
nano .env
```

Ändere:
```env
ALLOWED_ORIGINS=https://deine-domain.de,http://localhost:3000
JWT_SECRET=<generiere-mit-openssl-rand-base64-32>
```

### 3. KeepLocal mit NPM-Konfiguration starten
```bash
docker-compose -f docker-compose.npm.yml up -d
```

### 4. In Nginx Proxy Manager konfigurieren

#### Proxy Host erstellen:
- **Domain:** `keeplocal.deine-domain.de`
- **Forward to:** `keeplocal-client:80`
- ✅ **Websockets Support** aktivieren!
- ✅ **SSL** mit Let's Encrypt einrichten

#### Custom Nginx Config (Tab "Advanced"):
```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# WebSocket Support - WICHTIG!
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
proxy_buffering off;
```

### 5. Fertig! 🎉

Öffne `https://keeplocal.deine-domain.de` und erstelle deinen Admin-Account.

## Häufigste Probleme

### CORS Error?
→ `ALLOWED_ORIGINS` in `.env` prüfen und Container neu starten:
```bash
docker-compose -f docker-compose.npm.yml restart
```

### 502 Bad Gateway?
→ Container laufen prüfen:
```bash
docker ps | grep keeplocal
docker logs keeplocal-client
```

### WebSocket Fehler?
→ In NPM: **Websockets Support** aktivieren + Custom Config überprüfen

## Vollständige Anleitung

Siehe [NGINX_PROXY_MANAGER.md](./NGINX_PROXY_MANAGER.md) für Details.
