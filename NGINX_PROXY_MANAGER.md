# KeepLocal mit Nginx Proxy Manager einrichten

Diese Anleitung zeigt dir, wie du KeepLocal hinter Nginx Proxy Manager (NPM) betreibst.

## Voraussetzungen

- Nginx Proxy Manager ist bereits installiert und läuft
- Eine Domain oder Subdomain (z.B. `keeplocal.deine-domain.de`)
- SSL-Zertifikat (kann NPM automatisch via Let's Encrypt erstellen)

## Schritt 1: NPM Netzwerk erstellen (falls nicht vorhanden)

```bash
docker network create npm-network
```

Falls NPM bereits ein eigenes Netzwerk hat, kannst du das verwenden. Prüfe mit:
```bash
docker network ls
```

## Schritt 2: Umgebungsvariablen anpassen

Erstelle eine `.env` Datei im KeepLocal Hauptverzeichnis:

```bash
# .env Datei
JWT_SECRET=dein-sehr-langes-und-sicheres-secret-hier-mindestens-32-zeichen
ALLOWED_ORIGINS=https://keeplocal.deine-domain.de
```

**WICHTIG:** Ersetze `keeplocal.deine-domain.de` mit deiner echten Domain!

## Schritt 3: Docker Compose mit NPM starten

### Option A: Wenn NPM das Standardnetzwerk verwendet

```bash
# Stoppe die alte Installation (falls läuft)
docker-compose down

# Starte mit NPM-Konfiguration
docker-compose -f docker-compose.npm.yml up -d
```

### Option B: Wenn NPM ein eigenes Netzwerk hat

Bearbeite `docker-compose.npm.yml` und ändere den Netzwerknamen:

```yaml
networks:
  npm-network:
    external: true
    name: dein-npm-netzwerk-name  # z.B. "npm_default" oder "nginxproxymanager_default"
```

## Schritt 4: Nginx Proxy Manager konfigurieren

### 1. Proxy Host erstellen

Logge dich in NPM ein und gehe zu **Hosts → Proxy Hosts → Add Proxy Host**

#### Tab: Details
- **Domain Names:** `keeplocal.deine-domain.de`
- **Scheme:** `http`
- **Forward Hostname / IP:** `keeplocal-client` (der Container-Name!)
- **Forward Port:** `80`
- ✅ **Cache Assets** (aktivieren)
- ✅ **Block Common Exploits** (aktivieren)
- ✅ **Websockets Support** (WICHTIG für KeepLocal!)

#### Tab: SSL
- ✅ **SSL Certificate:** Wähle ein bestehendes oder erstelle ein neues Let's Encrypt Zertifikat
- ✅ **Force SSL** (aktivieren)
- ✅ **HTTP/2 Support** (aktivieren)
- ✅ **HSTS Enabled** (aktivieren)

#### Tab: Advanced

Füge diese Custom Nginx Configuration hinzu:

```nginx
# Proxy Headers für korrekte Client-Informationen
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;

# WebSocket Support (KRITISCH für KeepLocal!)
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

# Timeout-Einstellungen für lange Verbindungen
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;

# Buffering für bessere Performance
proxy_buffering off;
proxy_request_buffering off;

# CORS Headers (falls benötigt)
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
```

**Speichern** und fertig!

## Schritt 5: API-Endpunkt einrichten (Optional, aber empfohlen)

Wenn du möchtest, kannst du einen separaten Proxy Host für die API erstellen:

**Domain:** `api.keeplocal.deine-domain.de`
**Forward Hostname:** `keeplocal-server`
**Forward Port:** `5000`

Rest wie oben konfigurieren.

## Fehlerbehebung

### Problem: "CORS Error" oder "Network Error"

**Lösung:** Prüfe, ob `ALLOWED_ORIGINS` korrekt gesetzt ist:

```bash
# Container neu starten mit korrekten Umgebungsvariablen
docker-compose -f docker-compose.npm.yml down
docker-compose -f docker-compose.npm.yml up -d
```

### Problem: WebSocket-Verbindungen schlagen fehl

**Lösung:** Stelle sicher, dass:
1. ✅ **Websockets Support** in NPM aktiviert ist
2. Die Custom Nginx Config die WebSocket-Header enthält
3. `proxy_http_version 1.1` gesetzt ist

### Problem: 502 Bad Gateway

**Lösung:**
1. Prüfe, ob die Container laufen:
```bash
docker ps | grep keeplocal
```

2. Prüfe die Logs:
```bash
docker logs keeplocal-client
docker logs keeplocal-server
```

3. Prüfe, ob die Container im gleichen Netzwerk sind:
```bash
docker network inspect npm-network
```

### Problem: Container können nicht mit NPM kommunizieren

**Lösung:** Verbinde die Container manuell mit dem NPM-Netzwerk:

```bash
# Finde das NPM Netzwerk
docker network ls

# Verbinde die Container
docker network connect npm-network keeplocal-client
docker network connect npm-network keeplocal-server
```

## Sicherheitshinweise

1. **Ändere JWT_SECRET:** Verwende einen sicheren, langen Zufallsstring!
   ```bash
   openssl rand -base64 32
   ```

2. **Aktiviere HTTPS:** Immer Let's Encrypt Zertifikate verwenden!

3. **Firewall:** Stelle sicher, dass nur Port 443 und 80 (für Let's Encrypt) von außen erreichbar sind

4. **MongoDB:** MongoDB sollte NICHT direkt von außen erreichbar sein (kein Port-Mapping!)

## Testen

Nach dem Setup:

1. Öffne `https://keeplocal.deine-domain.de` in deinem Browser
2. Erstelle einen Admin-Account (beim ersten Start)
3. Teste das Erstellen, Bearbeiten und Löschen von Notizen
4. Prüfe die Browser-Konsole auf CORS-Fehler

## Performance-Tipps

1. **Caching aktivieren:** In NPM unter "Cache Assets"
2. **HTTP/2 aktivieren:** Für schnellere Ladezeiten
3. **GZIP Compression:** Wird automatisch von NPM aktiviert

## Beispiel: Komplette ALLOWED_ORIGINS

Wenn du mehrere Domains hast:

```env
ALLOWED_ORIGINS=https://keeplocal.example.com,https://notes.example.com,http://localhost:3000
```

Trenne mehrere Origins mit Komma (ohne Leerzeichen!)

## Support

Bei Problemen:
1. Prüfe die Container-Logs: `docker logs keeplocal-client`
2. Prüfe die NPM-Logs in der NPM-Oberfläche
3. Öffne ein Issue auf GitHub
