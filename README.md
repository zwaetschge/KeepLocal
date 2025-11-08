# KeepLocal 📝

Eine lokale Notizen-App inspiriert von Google Keep. Erstellen, bearbeiten und organisieren Sie Ihre Notizen mit einer intuitiven Benutzeroberfläche.

## Features

- ✅ Notizen erstellen, bearbeiten und löschen
- 🎨 10 verschiedene Farben für Ihre Notizen
- 📱 Responsive Design (funktioniert auf Desktop und Mobile)
- 🚀 Schnelle und einfache Bedienung
- 💾 REST API Backend mit Express.js
- ⚛️ Moderne React Frontend-Architektur

## Technologie-Stack

### Frontend
- React 18
- Axios für HTTP-Requests
- CSS3 mit Grid Layout

### Backend
- Node.js
- Express.js
- UUID für eindeutige IDs
- CORS für Cross-Origin Requests

## Installation

### Voraussetzungen

- Node.js (Version 14 oder höher)
- npm oder yarn

### Setup

1. **Repository klonen**
   ```bash
   git clone https://github.com/zwaetschge/KeepLocal.git
   cd KeepLocal
   ```

2. **Server installieren und starten**
   ```bash
   cd server
   npm install
   npm start
   ```

   Der Server läuft auf: `http://localhost:5000`

3. **Client installieren und starten** (neues Terminal-Fenster)
   ```bash
   cd client
   npm install
   npm start
   ```

   Die App öffnet sich automatisch unter: `http://localhost:3000`

## Verwendung

### Notiz erstellen
1. Klicken Sie auf das Eingabefeld "Notiz eingeben..."
2. Optional: Fügen Sie einen Titel hinzu
3. Geben Sie den Inhalt Ihrer Notiz ein
4. Wählen Sie eine Farbe aus der Farbpalette
5. Klicken Sie auf "Speichern"

### Notiz bearbeiten
1. Klicken Sie auf das Stift-Symbol (✏️) einer Notiz
2. Bearbeiten Sie Titel und/oder Inhalt
3. Klicken Sie auf "Speichern"

### Notiz löschen
1. Klicken Sie auf das Papierkorb-Symbol (🗑️) einer Notiz
2. Die Notiz wird sofort gelöscht

## API-Endpunkte

### GET /api/notes
Gibt alle Notizen zurück

### GET /api/notes/:id
Gibt eine einzelne Notiz zurück

### POST /api/notes
Erstellt eine neue Notiz

**Body:**
```json
{
  "title": "Titel (optional)",
  "content": "Inhalt (erforderlich)",
  "color": "#ffffff"
}
```

### PUT /api/notes/:id
Aktualisiert eine bestehende Notiz

**Body:**
```json
{
  "title": "Neuer Titel",
  "content": "Neuer Inhalt",
  "color": "#f28b82"
}
```

### DELETE /api/notes/:id
Löscht eine Notiz

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

## Hinweise

- Die Notizen werden aktuell **im Arbeitsspeicher** gespeichert
- Bei Neustart des Servers gehen alle Notizen verloren (außer die beiden Beispielnotizen)
- Für produktiven Einsatz: Datenbankintegration empfohlen (z.B. MongoDB, PostgreSQL)

## Erweiterungsmöglichkeiten

- 💾 Datenbankanbindung (MongoDB, PostgreSQL)
- 🔐 Benutzerauthentifizierung
- 🏷️ Tags/Kategorien für Notizen
- 📌 Notizen anheften (Pin)
- 🔍 Suchfunktion
- 📋 Checklisten in Notizen
- 🖼️ Bilder in Notizen einfügen
- 🌙 Dark Mode

## Lizenz

MIT License

## Autor

Erstellt mit ❤️ und Claude Code
