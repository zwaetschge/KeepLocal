require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const path = require('path');
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
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const app = express();
const PORT = process.env.PORT || 5000;

// Datenbankverbindung herstellen
connectDB();

// CORS-Konfiguration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    // Erlaube Requests ohne Origin (z.B. mobile apps, Postman)
    if (!origin) return callback(null, true);

    // Wenn ALLOWED_ORIGINS auf '*' gesetzt ist, erlaube alle Origins
    if (allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // Erlaube lokale IPs und localhost für Entwicklung/private Deployments
    // Regex validates proper IP octets (0-255) for private network ranges
    if (origin && (
      origin.match(/^http:\/\/localhost(:\d+)?$/) ||
      origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/) ||
      origin.match(/^http:\/\/192\.168\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(:\d+)?$/) ||
      origin.match(/^http:\/\/10\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(:\d+)?$/) ||
      origin.match(/^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(:\d+)?$/)
    )) {
      return callback(null, true);
    }

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Rate Limiting - Schutz vor Brute-Force-Angriffen
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 500, // Maximal 500 Requests pro IP in 15 Minuten (~33/min für normale Nutzung)
  message: 'Zu viele Anfragen von dieser IP, bitte versuchen Sie es später erneut.',
  standardHeaders: true,
  legacyHeaders: false,
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
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Built-in Express body parser (seit 4.16.0)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(limiter); // Rate Limiting anwenden

// Sicherheit: XSS-Schutz durch Input-Sanitization
app.use(sanitizeInputMiddleware);

// Secure file serving for uploaded images - requires authentication and authorization
// Users can only access files from notes they own or have access to
app.get('/uploads/*', authenticateToken, secureFileServe);

// CSRF-Schutz (nach cookieParser, vor Routen)
// Auth-Routen sind ausgenommen, da sie keine CSRF-Token benötigen
const csrfProtection = csrf({ cookie: true });

// CSRF-Token-Endpunkt
// GET-Anfragen werden nicht validiert, aber der Middleware ist nötig für req.csrfToken()
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
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
app.use('/api/auth', authRouter);
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
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Error Handler (muss am Ende sein)
app.use(errorHandler);

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
  console.log(`📝 API verfügbar unter: http://localhost:${PORT}/api/v1`);
  console.log(`📖 API-Dokumentation: http://localhost:${PORT}/api/docs`);
});

module.exports = app;
