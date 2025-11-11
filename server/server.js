require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const csrf = require('csurf');
const connectDB = require('./config/database');
const notesRouter = require('./routes/notes');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const errorHandler = require('./middleware/errorHandler');
const sanitizeInputMiddleware = require('./middleware/sanitizeInput');

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
    if (origin && (
      origin.match(/^http:\/\/localhost(:\d+)?$/) ||
      origin.match(/^http:\/\/127\.0\.0\.1(:\d+)?$/) ||
      origin.match(/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/) ||
      origin.match(/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/) ||
      origin.match(/^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+(:\d+)?$/)
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
  max: 100, // Maximal 100 Requests pro IP in 15 Minuten
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
app.use(bodyParser.json({ limit: '10mb' })); // Limit für JSON payload
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(limiter); // Rate Limiting anwenden

// Sicherheit: XSS-Schutz durch Input-Sanitization
app.use(sanitizeInputMiddleware);

// CSRF-Schutz (nach cookieParser, vor Routen)
// Auth-Routen sind ausgenommen, da sie keine CSRF-Token benötigen
const csrfProtection = csrf({ cookie: true });

// CSRF-Token-Endpunkt
// GET-Anfragen werden nicht validiert, aber der Middleware ist nötig für req.csrfToken()
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Routen (Auth ohne CSRF-Schutz)
app.use('/api/auth', authRouter);
app.use('/api/notes', csrfProtection, notesRouter);
app.use('/api/admin', csrfProtection, adminRouter);

// Root-Route
app.get('/', (req, res) => {
  res.json({
    message: 'KeepLocal API Server',
    version: '2.0.0',
    endpoints: {
      notes: '/api/notes'
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
  console.log(`📝 API verfügbar unter: http://localhost:${PORT}/api/notes`);
});

module.exports = app;
