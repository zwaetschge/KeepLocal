# KeepLocal 📝

A self-hosted notes application inspired by Google Keep. Create, edit, and organize your notes with an intuitive user interface.

## Features

- ✅ Create, edit, and delete notes with confirmation dialogs
- 🎨 10 different colors for your notes
- 📌 Pin/unpin functionality
- 🏷️ Tags/categories for better organization
- 🔍 Full-text search in title and content
- 🌙 Dark mode with theme persistence
- 📱 Responsive design (works on desktop and mobile)
- 🚀 Fast and easy to use
- 💾 MongoDB database integration
- 🔒 Advanced security (XSS protection, CORS, Rate Limiting)
- ⚛️ Modern React frontend architecture
- 🎯 Toast notifications for better feedback
- 🐳 Docker & Unraid support for easy deployment

## Technology Stack

### Frontend
- React 18
- Axios for HTTP requests
- CSS3 with Grid Layout & CSS Variables for theming
- DOMPurify for XSS protection

### Backend
- Node.js
- Express.js
- MongoDB & Mongoose
- Helmet for security headers
- Express Rate Limit
- XSS sanitization
- CORS with origin control

## Quick Start with Docker (Recommended)

The easiest way to run KeepLocal is using Docker Compose:

### Prerequisites
- Docker
- Docker Compose

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/zwaetschge/KeepLocal.git
   cd KeepLocal
   ```

2. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Access the application**

   Open your browser and navigate to: `http://localhost:3000`

That's it! The application will automatically:
- Set up MongoDB
- Configure the backend server
- Build and serve the frontend
- Handle all networking between services

### Docker Commands

```bash
# Start the application
docker-compose up -d

# Stop the application
docker-compose down

# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop and remove all data (including database)
docker-compose down -v
```

## Unraid Installation

### Method 1: Using Docker Compose (Recommended)

1. Install the **Docker Compose Manager** plugin from Community Applications
2. Create a new stack in Docker Compose Manager
3. Copy the contents of `docker-compose.yml` from this repository
4. Click "Compose Up"
5. Access via `http://[UNRAID-IP]:3000`

### Method 2: Using Unraid Template

1. Go to **Docker** tab in Unraid
2. Click **Add Container**
3. Under **Template repositories**, add:
   ```
   https://raw.githubusercontent.com/zwaetschge/KeepLocal/main/unraid-template.xml
   ```
4. Search for **KeepLocal** and install
5. Configure the following:
   - **WebUI Port**: 3000 (or your preferred port)
   - **MongoDB Data Path**: `/mnt/user/appdata/keeplocal/mongodb`
   - **ALLOWED_ORIGINS**: Update with your Unraid IP
6. Click **Apply**

### Unraid Configuration

After installation, you may need to update the CORS settings:

1. Go to Docker tab
2. Click on KeepLocal container
3. Edit the **ALLOWED_ORIGINS** variable
4. Add your Unraid server IP: `http://[UNRAID-IP]:3000`
5. Click **Apply**

## Manual Installation (Development)

### Prerequisites

- Node.js (Version 14 or higher)
- npm or yarn
- MongoDB (local or MongoDB Atlas)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/zwaetschge/KeepLocal.git
   cd KeepLocal
   ```

2. **Configure MongoDB**

   Create a `.env` file in the `server/` directory:
   ```bash
   cd server
   cp .env.example .env
   ```

   Edit the `.env` file and set your MongoDB URI:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/keeplocal
   ALLOWED_ORIGINS=http://localhost:3000
   ```

3. **Install and start the server**
   ```bash
   npm install
   npm start
   ```

   The server runs on: `http://localhost:5000`

4. **Install and start the client** (new terminal window)
   ```bash
   cd ../client
   npm install
   npm start
   ```

   The app opens automatically at: `http://localhost:3000`

## Usage

### Creating a Note
1. Click on the input field "Enter a note..."
2. Optional: Add a title
3. Enter your note content
4. Optional: Add tags (comma-separated)
5. Select a color from the palette
6. Click "Save"

### Editing a Note
1. Click the pencil icon (✏️) on a note
2. Edit the title, content, and/or tags
3. Click "Save"

### Deleting a Note
1. Click the trash icon (🗑️) on a note
2. Confirm deletion in the dialog

### Pinning a Note
1. Click the pin icon (📍/📌) on a note
2. Pinned notes appear at the top

### Searching Notes
1. Use the search bar at the top
2. Search queries filter title and content in real-time

### Dark Mode
1. Click the moon/sun icon in the bottom right
2. Your preference is automatically saved

## API Endpoints

### GET /api/notes
Returns all notes (sorted by pin status and creation date)

**Query Parameters:**
- `search`: Full-text search in title and content
- `tag`: Filter by tag

### GET /api/notes/:id
Returns a single note

### POST /api/notes
Creates a new note

**Body:**
```json
{
  "title": "Title (optional)",
  "content": "Content (required)",
  "color": "#ffffff",
  "tags": ["work", "important"],
  "isPinned": false
}
```

### PUT /api/notes/:id
Updates an existing note

**Body:**
```json
{
  "title": "New Title",
  "content": "New Content",
  "color": "#f28b82",
  "tags": ["personal"],
  "isPinned": true
}
```

### DELETE /api/notes/:id
Deletes a note

### POST /api/notes/:id/pin
Toggles pin status of a note

## Project Structure

```
KeepLocal/
├── client/                     # React Frontend
│   ├── public/
│   ├── src/
│   │   ├── components/        # React Components
│   │   │   ├── ConfirmDialog.js
│   │   │   ├── Note.js
│   │   │   ├── NoteForm.js
│   │   │   ├── NoteList.js
│   │   │   ├── SearchBar.js
│   │   │   ├── ThemeToggle.js
│   │   │   └── Toast.js
│   │   ├── utils/             # Utility functions
│   │   ├── App.js
│   │   └── index.js
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
│
├── server/                    # Express Backend
│   ├── config/
│   │   └── database.js
│   ├── middleware/
│   │   ├── errorHandler.js
│   │   └── sanitizeInput.js
│   ├── models/
│   │   └── Note.js
│   ├── routes/
│   │   └── notes.js
│   ├── utils/
│   │   └── sanitize.js
│   ├── Dockerfile
│   ├── server.js
│   └── package.json
│
├── docker-compose.yml         # Docker Compose configuration
├── unraid-template.xml        # Unraid template
├── .env.example              # Environment variables example
├── .gitignore
└── README.md
```

## Development

### Running Server in Development Mode

```bash
cd server
npm run dev
```

Uses `nodemon` for automatic reloading on changes.

### Creating Production Build

```bash
cd client
npm run build
```

Creates an optimized production build in the `client/build/` directory.

## Security

KeepLocal implements multiple security layers:

- **XSS Protection**: Input sanitization on server and client
- **CORS Control**: Only allowed origins can access the API
- **Rate Limiting**: Protection against brute-force attacks (100 requests/15min)
- **Security Headers**: Helmet.js for additional HTTP header security
- **Input Validation**: Mongoose schema validation
- **Payload Limits**: Request size restrictions

## Environment Variables

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/keeplocal` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:3000` |
| `SESSION_SECRET` | Session encryption key | Random string |

## Notes

- Notes are stored persistently in **MongoDB**
- Ensure MongoDB is running before starting the server
- The `.env` file contains sensitive configuration and should not be committed
- For Docker deployments, MongoDB is automatically configured
- All data is stored in Docker volumes for persistence

## Troubleshooting

### Docker Issues

**Port already in use:**
```bash
# Change the port in docker-compose.yml
ports:
  - "8080:80"  # Use port 8080 instead of 3000
```

**Cannot connect to MongoDB:**
```bash
# Check if MongoDB container is running
docker-compose ps

# View MongoDB logs
docker-compose logs mongodb
```

**Reset everything:**
```bash
# Stop and remove all containers and volumes
docker-compose down -v

# Start fresh
docker-compose up -d
```

### Unraid Issues

**Cannot access WebUI:**
1. Check if the container is running
2. Verify port mapping in container settings
3. Update ALLOWED_ORIGINS with your Unraid IP
4. Check firewall settings

**Database not persisting:**
1. Ensure the appdata path is correctly configured
2. Check permissions on `/mnt/user/appdata/keeplocal/`

## Future Enhancements

- 🔐 User authentication & multi-user support
- 📋 Checklists in notes
- 🖼️ Image attachments in notes
- 📄 Pagination for large note collections
- 🔄 Real-time synchronization with WebSockets
- 📤 Export/Import functionality
- 🗂️ Note archives
- 📱 Mobile apps (iOS/Android)
- 🔗 Note sharing & collaboration
- 🔔 Reminders & notifications

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

MIT License

## Author

Created with ❤️ and Claude Code

## Acknowledgments

- Inspired by Google Keep
- Built with React and Express
- MongoDB for data persistence
- Docker for easy deployment
