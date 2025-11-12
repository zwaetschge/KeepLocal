# KeepLocal unter CachyOS testen

Diese Anleitung erklärt, wie du KeepLocal auf CachyOS (Arch-basiert) installierst und testest.

## Methode 1: Docker Compose (Empfohlen)

### Voraussetzungen installieren

```bash
# System aktualisieren
sudo pacman -Syu

# Docker und Docker Compose installieren
sudo pacman -S docker docker-compose

# Docker-Dienst starten und beim Booten aktivieren
sudo systemctl start docker
sudo systemctl enable docker

# Aktuellen Benutzer zur docker-Gruppe hinzufügen
sudo usermod -aG docker $USER

# Neuanmeldung erforderlich (oder neu starten)
# Oder verwende: newgrp docker
```

### KeepLocal Installation

```bash
# Repository klonen
git clone https://github.com/zwaetschge/KeepLocal.git
cd KeepLocal

# Mit Docker Compose starten
docker-compose up -d

# Logs anzeigen (optional)
docker-compose logs -f
```

### Zugriff auf die Anwendung

1. Öffne deinen Browser
2. Navigiere zu: `http://localhost:3000`
3. Erstelle dein Admin-Konto beim ersten Start
4. Fertig!

### Nützliche Docker-Befehle

```bash
# Status der Container prüfen
docker-compose ps

# Logs anzeigen
docker-compose logs -f

# Container stoppen
docker-compose down

# Container neu starten
docker-compose restart

# Alles löschen (inkl. Daten!)
docker-compose down -v

# Nur bestimmten Container neu starten
docker-compose restart server
docker-compose restart client
docker-compose restart mongodb
```

## Methode 2: Manuelle Installation (Entwicklung)

### Voraussetzungen

```bash
# Node.js und npm installieren
sudo pacman -S nodejs npm

# MongoDB installieren
sudo pacman -S mongodb-bin

# MongoDB starten
sudo systemctl start mongodb
sudo systemctl enable mongodb
```

### Backend installieren

```bash
# In den Server-Ordner wechseln
cd server

# Abhängigkeiten installieren
npm install

# .env-Datei erstellen
cp .env.example .env

# .env-Datei bearbeiten (optional)
nano .env
```

Beispiel `.env`:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/keeplocal
ALLOWED_ORIGINS=http://localhost:3000
SESSION_SECRET=dein-geheimes-passwort-hier
JWT_SECRET=dein-jwt-secret-hier
```

```bash
# Server starten
npm start

# Oder für Entwicklung mit Auto-Reload:
npm run dev
```

### Frontend installieren (neues Terminal)

```bash
# In den Client-Ordner wechseln
cd client

# Abhängigkeiten installieren
npm install

# React-App starten
npm start
```

Die App öffnet sich automatisch unter `http://localhost:3000`

## Firewall konfigurieren (falls aktiv)

Wenn du eine Firewall verwendest:

```bash
# Für ufw (falls installiert)
sudo ufw allow 3000/tcp
sudo ufw allow 5000/tcp
sudo ufw allow 27017/tcp

# Für firewalld (falls installiert)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=5000/tcp
sudo firewall-cmd --permanent --add-port=27017/tcp
sudo firewall-cmd --reload
```

## Troubleshooting

### Docker-Berechtigungsfehler

```bash
# Wenn "permission denied" Fehler auftreten:
sudo chmod 666 /var/run/docker.sock

# Oder dauerhaft:
sudo usermod -aG docker $USER
newgrp docker
```

### Port bereits belegt

```bash
# Prüfen, welcher Prozess Port 3000 nutzt
sudo lsof -i :3000

# Prozess beenden (PID von lsof)
sudo kill -9 <PID>

# Oder anderen Port in docker-compose.yml verwenden:
# Ändere "3000:80" zu "8080:80"
```

### MongoDB-Verbindungsfehler

```bash
# MongoDB-Status prüfen
sudo systemctl status mongodb

# MongoDB-Logs anzeigen
sudo journalctl -u mongodb -f

# MongoDB neu starten
sudo systemctl restart mongodb
```

### Container starten nicht

```bash
# Alte Container und Volumes entfernen
docker-compose down -v

# Images neu bauen
docker-compose build --no-cache

# Neu starten
docker-compose up -d
```

## Performance-Tipps für CachyOS

CachyOS ist bereits für Performance optimiert, aber hier ein paar zusätzliche Tipps:

### Docker optimieren

Erstelle/bearbeite `/etc/docker/daemon.json`:

```json
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

Dann Docker neu starten:
```bash
sudo systemctl restart docker
```

### MongoDB optimieren

Für bessere Performance bei MongoDB:

```bash
# In MongoDB Shell
mongosh

# Oder für ältere Versionen:
mongo

# Index erstellen (optional, wird automatisch gemacht)
use keeplocal
db.notes.createIndex({ userId: 1, isPinned: -1, createdAt: -1 })
db.notes.createIndex({ userId: 1, tags: 1 })
db.notes.createIndex({ userId: 1, title: "text", content: "text" })
```

## Deinstallation

### Docker Compose

```bash
cd KeepLocal
docker-compose down -v
cd ..
rm -rf KeepLocal
```

### Manuell

```bash
# MongoDB-Datenbank löschen (optional)
mongosh
use keeplocal
db.dropDatabase()
exit

# Projektordner löschen
cd ..
rm -rf KeepLocal

# MongoDB deinstallieren (optional)
sudo systemctl stop mongodb
sudo systemctl disable mongodb
sudo pacman -R mongodb-bin
```

## Nützliche Links

- [KeepLocal GitHub](https://github.com/zwaetschge/KeepLocal)
- [Docker Dokumentation](https://docs.docker.com/)
- [CachyOS Wiki](https://wiki.cachyos.org/)
- [MongoDB Dokumentation](https://www.mongodb.com/docs/)

## Weitere Informationen

- Die Daten werden in einem Docker Volume gespeichert (`keeplocal_mongodb-data`)
- Beim ersten Start wird automatisch ein Setup-Screen angezeigt
- Standard-Ports: Frontend (3000), Backend (5000), MongoDB (27017)
- Alle Passwörter werden mit bcrypt gehasht
- CSRF-Tokens werden automatisch generiert

## Support

Bei Problemen:
1. Prüfe die Logs: `docker-compose logs -f`
2. Öffne ein Issue auf GitHub
3. Prüfe die [FAQ im README](README.md)
