require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const connectDB = require('./config/database');
const notesRouter = require('./routes/notes');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const friendsRouter = require('./routes/friends');
const apiKeysRouter = require('./routes/apiKeys');
const v1Router = require('./routes/v1');
const errorHandler = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/auth');
const { authenticateSessionOrApiKey } = require('./middleware/apiKeyAuth');
const secureFileServe = require('./middleware/secureFileServe');
const noStore = require('./middleware/noStore');
const errorCodeMiddleware = require('./middleware/errorCodes');
const requestId = require('./middleware/requestId');
const logger = require('./utils/logger');
const { collectHealth, publicHealth } = require('./services/healthService');
const { csrfProtection, issueCsrfToken } = require('./middleware/csrfProtection');
const passport = require('passport');
const { configurePassport } = require('./config/passport');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const mongoose = require('mongoose');
const { ensureNoteTextIndex } = require('./config/indexMigration');
const { startStorageJanitor } = require('./services/storageJanitor');
const { startBackupScheduler } = require('./services/backupScheduler');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Version (v1.15.0): Der Build schreibt sie vom ARG APP_VERSION nach
// /app/server/VERSION (Dockerfile.allinone). Ohne Datei (lokal, Tests): 'dev'.
// Vorher stand in der Root-Route ein hartkodiertes '2.0.0', das seit Jahren
// keiner realen Release-Nummer entsprach — /api/health meldete gar keine.
const APP_VERSION = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim() || 'dev';
  } catch (_error) {
    return 'dev';
  }
})();

// Readiness-Details: außerhalb von production standardmäßig an (lokale
// Fehlersuche), in production nur mit HEALTH_DETAILS=true.
const healthDetailsEnabled = process.env.HEALTH_DETAILS
  ? process.env.HEALTH_DETAILS === 'true'
  : process.env.NODE_ENV !== 'production';

function parseTrustProxy(value) {
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// CORS-Konfiguration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : ['http://localhost:3000'];

if (process.env.NODE_ENV === 'production' && allowedOrigins.includes('*')) {
  throw new Error('ALLOWED_ORIGINS must list explicit origins in production');
}

const privateDevelopmentOrigin = /^http:\/\/(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$/;

function isAllowedOrigin(req, origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && privateDevelopmentOrigin.test(origin)) return true;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const requestHost = String(req.headers.host || '')
        .split(',')[0]
        .trim();
      return new URL(origin).host === requestHost;
    } catch (_) {
      return false;
    }
  }
  return false;
}

const corsMiddleware = cors({
  origin: true,
  credentials: true,
  optionsSuccessStatus: 200
});

// Rate Limiting - Schutz vor Brute-Force-Angriffen
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 500, // Maximal 500 Requests pro IP in 15 Minuten (~33/min für normale Nutzung)
  handler: (req, res) => res.status(429).json({
    error: 'Zu viele Anfragen von dieser IP, bitte versuchen Sie es spaeter erneut.',
    code: 'RATE_LIMITED'
  }),
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: 'Zu viele Anmeldeversuche. Bitte versuchen Sie es spaeter erneut.',
    code: 'AUTH_RATE_LIMITED'
  })
});

// Middleware
// Sicherheits-Header mit Content Security Policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(compression()); // Gzip-Komprimierung für Responses
// Request-Id zuerst, damit jede Logzeile und die AI-Weiterleitung korrelierbar ist.
app.use(requestId);
// API responses can contain account data or session state. Prevent browser,
// proxy, and CDN caches even when the backend is reached directly instead of
// through the frontend proxy. /uploads ist seit v1.15.0 bewusst NICHT mehr
// dabei: Speichernamen sind frisches Random-Hex und Content wird nie mutiert,
// secureFileServe setzt daher private+immutable und erlaubt ETag/304 — jedes
// Notizöffnen re-transferierte vorher alle Bilder und PDFs komplett.
app.use('/api', noStore);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(req, origin)) {
    return res.status(403).json({ error: 'Origin ist nicht erlaubt' });
  }
  return corsMiddleware(req, res, next);
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
// Stable Fehler-Codes in jeder JSON-Error-Response (vor den Routen mounten).
app.use(errorCodeMiddleware);
app.use(limiter); // Rate Limiting anwenden
app.use([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/demo',
  // Passwort-Endpunkte: Brute-Force gegen das aktuelle Passwort und gegen
  // Reset-Tokens muss genauso gedrosselt werden wie der Login selbst.
  '/api/auth/change-password',
  '/api/auth/reset-password'
], authLimiter);

// Passport OAuth initialization (stateless — we use JWT, not sessions)
app.use(passport.initialize());
configurePassport();

// Secure file serving for uploaded images - requires authentication and authorization
// Users can only access files from notes they own or have access to.
// Session ODER API-Key (v1.15.0): v1-Clients konnten Anhänge hochladen, die
// Datei-URL aber nie abrufen, weil dieses Mount nur die Session kannte.
app.get('/uploads/*', authenticateSessionOrApiKey, secureFileServe);

// CSRF-Token-Endpunkt
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: issueCsrfToken(req, res) });
});

// --- API Documentation (Swagger UI) ---
// In Produktion standardmäßig deaktiviert (vermeidet öffentliche Endpoint-Aufklärung);
// explizit aktivierbar über ENABLE_API_DOCS=true.
const apiDocsEnabled = process.env.ENABLE_API_DOCS === 'true'
  || (process.env.ENABLE_API_DOCS !== 'false' && process.env.NODE_ENV !== 'production');

if (apiDocsEnabled) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'KeepLocal API Docs',
    swaggerOptions: {
      persistAuthorization: true
    }
  }));

  // OpenAPI spec as JSON
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// --- External API v1 (API-Key auth, no CSRF) ---
app.use('/api/v1', v1Router);

// --- API Key Management (JWT auth, CSRF-protected from web UI) ---
app.use('/api/api-keys', csrfProtection, apiKeysRouter);

// --- Internal Routes (Frontend) ---
app.use('/api/auth', csrfProtection, authRouter);
app.use('/api/notes', csrfProtection, notesRouter);
app.use('/api/admin', csrfProtection, adminRouter);
app.use('/api/friends', csrfProtection, friendsRouter);

// Root-Route
app.get('/', (req, res) => {
  res.json({
    message: 'KeepLocal API Server',
    version: APP_VERSION,
    documentation: apiDocsEnabled ? '/api/docs' : undefined,
    api: {
      v1: '/api/v1',
      notes: '/api/v1/notes',
      tags: '/api/v1/tags',
      user: '/api/v1/user/me'
    }
  });
});

// Health check endpoint (for Docker/Kubernetes)
app.get('/api/health', async (req, res) => {
  const health = await collectHealth();
  res.status(health.ready ? 200 : 503).json({
    status: health.status,
    version: APP_VERSION,
    database: health.database.status,
    uptime: health.uptime,
    timestamp: health.timestamp
  });
});

// Liveness: läuft der Prozess? (ändert sich nie aufgrund externer Abhängigkeiten)
app.get('/api/health/live', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, uptime: process.uptime() });
});

// Readiness: echter DB-Ping, beschreibbares Upload-Volume, optional AI-Dienst.
// Compose-/Nginx-Healthchecks sollten diesen Endpunkt verwenden.
// Details (absolute Pfade, DB-Fehlertexte, AI-Endpunkt) sind für Betreiber
// nützlich, für anonyme Aufrufer aber eine kostenlose Informationsquelle über
// das interne Layout — deshalb außerhalb von development nur mit Opt-in.
app.get('/api/health/ready', async (req, res) => {
  const health = await collectHealth();
  const body = healthDetailsEnabled ? health : publicHealth(health);
  res.status(health.ready ? 200 : 503).json({ version: APP_VERSION, ...body });
});

app.use('/api', (req, res) => {
  const payload = { error: 'API-Endpunkt nicht gefunden' };
  if (req.originalUrl.startsWith('/api/v1')) {
    payload.success = false;
  }
  res.status(404).json(payload);
});

// Error Handler (muss am Ende sein)
app.use(errorHandler);

let httpServer;

async function startServer() {
  await connectDB();
  // Bevor mongoose die Schema-Indizes baut: den legacy Text-Index entfernen,
  // sonst schlägt der gewichtete Text-Index mit IndexOptionsConflict fehl und
  // der Server startet auf Bestandsinstallationen nicht mehr.
  try {
    const migration = await ensureNoteTextIndex(mongoose.connection);
    if (migration.dropped) {
      console.log(`Index-Migration: ${migration.dropped} entfernt (${migration.reason})`);
    }
  } catch (error) {
    console.error('Index-Migration fehlgeschlagen:', error.message);
    throw error;
  }
  // syncIndexes() statt init(): Bestandsinstallationen können Indizes mit
  // gleichem Namen, aber anderen Optionen haben — z. B. provider_1_providerId_1,
  // der früher nicht-eindeutig war und jetzt unique+partial ist. createIndex()
  // bricht dann mit "An existing index has the same name as the requested index"
  // ab, model.init() rejectet und der Server startet in einer Crash-Schleife,
  // obwohl die Daten völlig in Ordnung sind. syncIndexes() wirft veraltete und
  // konflikthafte Indizes weg und legt die Schema-Indizes neu an.
  await Promise.all(Object.values(mongoose.models).map(async (model) => {
    const dropped = await model.syncIndexes();
    if (Array.isArray(dropped) && dropped.length > 0) {
      logger.info('indexes synchronised', { model: model.modelName, dropped });
    }
  }));

  // Papierkorb zu Ende: MongoDBs TTL-Monitor loescht nur Dokumente, die
  // Bilddateien blieben bisher fuer immer liegen. Der erste Janitor-Lauf ist um
  // STORAGE_JANITOR_INITIAL_DELAY_MS (Default 60 s) verzoegert und die Timer
  // sind unref'd — der Start wird also weder blockiert noch offen gehalten.
  startStorageJanitor();

  // Backup-Scheduler (v1.13.0): dasselbe Muster — erster Lauf nach 5 Minuten,
  // danach alle 24 h, Timer unref'd. Backup-Status landet als JSON in der
  // Backup-Wurzel, sichtbar ueber /api/admin/backups.
  startBackupScheduler();

  return (httpServer = app.listen(PORT, HOST, () => {
    console.log(`Server laeuft auf ${HOST}:${PORT} (Version ${APP_VERSION})`);
    console.log(`API verfuegbar unter: http://localhost:${PORT}/api/v1`);
    if (apiDocsEnabled) {
      console.log(`API-Dokumentation: http://localhost:${PORT}/api/docs`);
    }
  }));
}

// Graceful Shutdown: laufende Requests abschließen, DB-Verbindung schließen.
// Docker/Kubernetes senden SIGTERM (docker stop) — ohne Handler bricht der
// Prozess sofort ab und schneidet in-flight Responses ab.
function shutdown(signal) {
  console.log(`${signal} erhalten — fahre Server herunter...`);
  const forceExit = setTimeout(() => {
    console.error('Graceful Shutdown Timeout — erzwinge Exit.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  if (httpServer) {
    httpServer.close(async () => {
      try {
        await mongoose.connection.close(false);
        console.log('Datenbankverbindung geschlossen. Server gestoppt.');
        process.exit(0);
      } catch (error) {
        console.error('Fehler beim Schließen der Datenbankverbindung:', error.message);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startServer().catch(error => {
    console.error('Server konnte nicht gestartet werden:', error.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
