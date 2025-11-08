# KeepLocal 📝

Eine lokale Notizen-App inspiriert von Google Keep. Erstellen, bearbeiten und organisieren Sie Ihre Notizen mit einer intuitiven Benutzeroberfläche.

## Features

- ✅ Notizen erstellen, bearbeiten und löschen mit Bestätigungsdialog
- 🎨 10 verschiedene Farben für Ihre Notizen
- 📌 Notizen anheften (Pin-Funktion)
- 🏷️ Tags/Kategorien für bessere Organisation
- 🔍 Volltextsuche in Titel und Inhalt
- 🌙 Dark Mode mit Themen-Persistenz
- 📱 Responsive Design (funktioniert auf Desktop und Mobile)
- 🚀 Schnelle und einfache Bedienung
- 💾 MongoDB Datenbankintegration
- 🔒 Erweiterte Sicherheit (XSS-Schutz, CORS, Rate Limiting)
- ⚛️ Moderne React Frontend-Architektur
- 🎯 Toast-Benachrichtigungen für besseres Feedback

## Technologie-Stack

### Frontend
- React 18
- Axios für HTTP-Requests
- CSS3 mit Grid Layout & CSS Variables für Theming
- DOMPurify für XSS-Schutz

### Backend
- Node.js
- Express.js
- MongoDB & Mongoose
- Helmet für Security Headers
- Express Rate Limit
- XSS-Sanitization
- CORS mit Origin-Kontrolle

## Installation

### Voraussetzungen

- Node.js (Version 14 oder höher)
- npm oder yarn
- MongoDB (lokal oder MongoDB Atlas)

### Setup

1. **Repository klonen**
   ```bash
   git clone https://github.com/zwaetschge/KeepLocal.git
   cd KeepLocal
   ```

2. **MongoDB konfigurieren**

   Erstellen Sie eine `.env` Datei im `server/` Verzeichnis:
   ```bash
   cd server
   cp .env.example .env
   ```

   Bearbeiten Sie die `.env` Datei und setzen Sie Ihre MongoDB-URI:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/keeplocal
   ALLOWED_ORIGINS=http://localhost:3000
   ```

3. **Server installieren und starten**
   ```bash
   npm install
   npm start
   ```

   Der Server läuft auf: `http://localhost:5000`

4. **Client installieren und starten** (neues Terminal-Fenster)
   ```bash
   cd ../client
   npm install
   npm start
   ```

   Die App öffnet sich automatisch unter: `http://localhost:3000`

## Verwendung

### Notiz erstellen
1. Klicken Sie auf das Eingabefeld "Notiz eingeben..."
2. Optional: Fügen Sie einen Titel hinzu
3. Geben Sie den Inhalt Ihrer Notiz ein
4. Optional: Fügen Sie Tags hinzu (durch Komma getrennt)
5. Wählen Sie eine Farbe aus der Farbpalette
6. Klicken Sie auf "Speichern"

### Notiz bearbeiten
1. Klicken Sie auf das Stift-Symbol (✏️) einer Notiz
2. Bearbeiten Sie Titel, Inhalt und/oder Tags
3. Klicken Sie auf "Speichern"

### Notiz löschen
1. Klicken Sie auf das Papierkorb-Symbol (🗑️) einer Notiz
2. Bestätigen Sie die Löschung im Dialog

### Notiz anheften
1. Klicken Sie auf das Pin-Symbol (📍/📌) einer Notiz
2. Angepinnte Notizen werden oben angezeigt

### Notizen durchsuchen
1. Nutzen Sie die Suchleiste am oberen Rand
2. Die Suche durchsucht Titel und Inhalt in Echtzeit

### Dark Mode
1. Klicken Sie auf das Mond/Sonne-Symbol unten rechts
2. Die Einstellung wird automatisch gespeichert

## API-Endpunkte

### GET /api/notes
Gibt alle Notizen zurück (sortiert nach Pin-Status und Erstelldatum)

**Query Parameter:**
- `search`: Volltextsuche in Titel und Inhalt
- `tag`: Filtern nach Tag

### GET /api/notes/:id
Gibt eine einzelne Notiz zurück

### POST /api/notes
Erstellt eine neue Notiz

**Body:**
```json
{
  "title": "Titel (optional)",
  "content": "Inhalt (erforderlich)",
  "color": "#ffffff",
  "tags": ["arbeit", "wichtig"],
  "isPinned": false
}
```

### PUT /api/notes/:id
Aktualisiert eine bestehende Notiz

**Body:**
```json
{
  "title": "Neuer Titel",
  "content": "Neuer Inhalt",
  "color": "#f28b82",
  "tags": ["privat"],
  "isPinned": true
}
```

### DELETE /api/notes/:id
Löscht eine Notiz

### POST /api/notes/:id/pin
Heftet eine Notiz an oder ab (Toggle)

## Projektstruktur

```
KeepLocal/
├── client/                 # React Frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/    # React Komponenten
│   │   │   ├── Note.js
│   │   │   ├── Note.css
│   │   │   ├── NoteForm.js
│   │   │   ├── NoteForm.css
│   │   │   ├── NoteList.js
│   │   │   └── NoteList.css
│   │   ├── App.js
│   │   ├── App.css
│   │   ├── index.js
│   │   └── index.css
│   └── package.json
│
├── server/                # Express Backend
│   ├── middleware/
│   │   └── errorHandler.js
│   ├── routes/
│   │   └── notes.js
│   ├── server.js
│   └── package.json
│
├── .gitignore
└── README.md
```

## Entwicklung

### Server im Development-Modus starten

```bash
cd server
npm run dev
```

Nutzt `nodemon` für automatisches Neuladen bei Änderungen.

### Production Build erstellen

```bash
cd client
npm run build
```

Erstellt einen optimierten Production-Build im `client/build/` Verzeichnis.

## Sicherheit

KeepLocal implementiert mehrere Sicherheitsebenen:

- **XSS-Schutz**: Input-Sanitization auf Server und Client
- **CORS-Kontrolle**: Nur erlaubte Origins können API-Zugriff erhalten
- **Rate Limiting**: Schutz vor Brute-Force-Angriffen (100 Requests/15min)
- **Security Headers**: Helmet.js für zusätzliche HTTP-Header-Sicherheit
- **Input-Validierung**: Mongoose Schema-Validierung
- **Payload-Limits**: Beschränkung der Request-Größe

## Hinweise

- Die Notizen werden persistent in **MongoDB** gespeichert
- Stellen Sie sicher, dass MongoDB läuft, bevor Sie den Server starten
- Die `.env` Datei enthält sensible Konfiguration und sollte nicht committet werden

## Erweiterungsmöglichkeiten

- 🔐 Benutzerauthentifizierung & Multi-User-Support
- 📋 Checklisten in Notizen
- 🖼️ Bilder in Notizen einfügen
- 📄 Paginierung für große Notiz-Sammlungen
- 🔄 Real-time Synchronisation mit WebSockets
- 📤 Export/Import Funktionalität
- 🗂️ Notiz-Archive

## Lizenz

MIT License

## Autor

Erstellt mit ❤️ und Claude Code
