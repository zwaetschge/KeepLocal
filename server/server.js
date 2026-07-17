require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/database');
const notesRouter = require('./routes/notes');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const friendsRouter = require('./routes/friends');
const apiKeysRouter = require('./routes/apiKeys');
const v1Router = require('./routes/v1');
const errorHandler = require('./middleware/errorHandler');
const sanitizeInputMiddleware = require('./middleware/sanitizeInput');
const { authenticateToken } = require('./middleware/auth');
const secureFileServe = require('./middleware/secureFileServe');
const noStore = require('./middleware/noStore');
const { csrfProtection, issueCsrfToken } = require('./middleware/csrfProtection');
const passport = require('passport');
const { configurePassport } = require('./config/passport');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

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
// API and private upload responses can contain account data or session state.
// Prevent browser, proxy, and CDN caches even when the backend is reached
// directly instead of through the frontend proxy.
app.use(['/api', '/uploads'], noStore);
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
app.use(limiter); // Rate Limiting anwenden
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/demo'], authLimiter);

// Passport OAuth initialization (stateless — we use JWT, not sessions)
app.use(passport.initialize());
configurePassport();

// Sicherheit: XSS-Schutz durch Input-Sanitization
app.use(sanitizeInputMiddleware);

// Secure file serving for uploaded images - requires authentication and authorization
// Users can only access files from notes they own or have access to
app.get('/uploads/*', authenticateToken, secureFileServe);

// CSRF-Token-Endpunkt
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: issueCsrfToken(req, res) });
});

// --- API Documentation (Swagger UI) ---
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
    version: '2.0.0',
    documentation: '/api/docs',
    api: {
      v1: '/api/v1',
      notes: '/api/v1/notes',
      tags: '/api/v1/tags',
      user: '/api/v1/user/me'
    }
  });
});

// Health check endpoint (for Docker/Kubernetes)
app.get('/api/health', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? 'ok' : 'degraded',
    database: databaseReady ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
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

async function startServer() {
  await connectDB();
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));

  return app.listen(PORT, HOST, () => {
    console.log(`Server laeuft auf ${HOST}:${PORT}`);
    console.log(`API verfuegbar unter: http://localhost:${PORT}/api/v1`);
    console.log(`API-Dokumentation: http://localhost:${PORT}/api/docs`);
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Server konnte nicht gestartet werden:', error.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.startServer = startServer;
