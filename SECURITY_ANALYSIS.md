# Security Vulnerability Assessment - KeepLocal

**Assessment Date:** 2025-11-16
**Codebase:** KeepLocal v2.0.0
**Assessed By:** Security Analysis Agent

## Executive Summary

This security assessment identified **8 vulnerabilities** across varying severity levels in the KeepLocal note-taking application. The most critical findings include **Server-Side Request Forgery (SSRF)**, **weak default JWT secret**, and **NoSQL injection vulnerabilities**. While the application implements several security best practices (CSRF protection, Helmet.js, rate limiting, XSS sanitization), critical vulnerabilities pose significant risks to confidentiality, integrity, and availability.

### Severity Distribution
- **CRITICAL:** 3 vulnerabilities
- **HIGH:** 2 vulnerabilities
- **MEDIUM:** 2 vulnerabilities
- **LOW:** 1 vulnerability

---

## CRITICAL Vulnerabilities

### 1. Server-Side Request Forgery (SSRF) in Link Preview Feature

**Severity:** CRITICAL
**CVSS Score:** 9.1 (Critical)
**Location:** `server/utils/linkPreview.js:10-70`
**CWE:** CWE-918 (Server-Side Request Forgery)

**Description:**
The `fetchLinkPreview()` function accepts user-controlled URLs without validation, allowing attackers to make arbitrary HTTP/HTTPS requests from the server. This can be exploited to:
- Access internal network resources (localhost, 192.168.x.x, 10.x.x.x)
- Scan internal ports and services
- Access cloud metadata endpoints (e.g., `http://169.254.169.254/latest/meta-data/`)
- Bypass firewalls and access restricted resources
- Perform Denial of Service attacks against internal/external services

**Vulnerable Code:**
```javascript
// server/utils/linkPreview.js:10-25
async function fetchLinkPreview(url) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      // NO VALIDATION - directly fetches user-supplied URL
      const request = protocol.get(url, options, (response) => {
        // Follows redirects without limit
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return fetchLinkPreview(response.headers.location)
            .then(resolve)
            .catch(reject);
        }
```

**Attack Vector:**
```bash
POST /api/notes/link-preview
{
  "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
}
```

**Impact:**
- Information disclosure (internal services, cloud credentials)
- Port scanning of internal network
- Access to sensitive internal APIs
- Potential Remote Code Execution via internal service exploitation

**Remediation:**
```javascript
const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0',
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,  // AWS metadata
  /^fd[0-9a-f]{2}:/i,      // IPv6 private
];

async function fetchLinkPreview(url) {
  const parsedUrl = new URL(url);

  // Validate protocol
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Invalid protocol');
  }

  // Validate hostname
  const hostname = parsedUrl.hostname.toLowerCase();
  for (const blocked of BLOCKED_HOSTS) {
    if (typeof blocked === 'string' ? hostname === blocked : blocked.test(hostname)) {
      throw new Error('Access to internal resources is not allowed');
    }
  }

  // Limit redirects
  // ... (implement redirect counter)
}
```

---

### 2. Weak Default JWT Secret

**Severity:** CRITICAL
**CVSS Score:** 9.8 (Critical)
**Location:** `server/middleware/auth.js:5`
**CWE:** CWE-798 (Use of Hard-coded Credentials)

**Description:**
The JWT authentication uses a weak, predictable fallback secret when `JWT_SECRET` environment variable is not set. This allows attackers to forge valid JWT tokens and impersonate any user, including administrators.

**Vulnerable Code:**
```javascript
// server/middleware/auth.js:5
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
```

**Attack Vector:**
1. If admin forgets to set `JWT_SECRET` in production, the weak default is used
2. Attacker discovers this through reconnaissance or source code access
3. Attacker forges a JWT token with admin privileges:
```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: 'admin-user-id' },
  'your-secret-key-change-in-production',
  { expiresIn: '7d' }
);
```
4. Attacker gains full administrative access to the system

**Impact:**
- Complete authentication bypass
- Privilege escalation to administrator
- Full system compromise
- Data exfiltration and manipulation

**Remediation:**
```javascript
// server/middleware/auth.js
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Fail-safe: refuse to start without proper secret
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be set and at least 32 characters long');
  process.exit(1);
}

// Additional validation
if (JWT_SECRET === 'your-secret-key-change-in-production') {
  console.error('ERROR: Default JWT_SECRET detected. Change it immediately!');
  process.exit(1);
}
```

**Additional Recommendation:**
Add a startup check in `server.js` that validates all critical environment variables before starting the server.

---

### 3. NoSQL Injection in Friends Search

**Severity:** CRITICAL
**CVSS Score:** 8.6 (High/Critical)
**Location:** `server/routes/friends.js:167-199`
**CWE:** CWE-943 (Improper Neutralization of Special Elements in Data Query Logic)

**Description:**
The friends search endpoint uses unsanitized user input directly in MongoDB regex queries, allowing NoSQL injection attacks. While the `sanitizeInputMiddleware` is applied globally, regex special characters are not properly escaped for MongoDB queries.

**Vulnerable Code:**
```javascript
// server/routes/friends.js:178-184
users = await User.find({
  $or: [
    { username: { $regex: query, $options: 'i' } },  // UNSANITIZED
    { email: { $regex: query, $options: 'i' } }      // UNSANITIZED
  ],
  _id: { $ne: req.user._id }
}).select('username email').limit(10);
```

**Attack Vector:**
```bash
GET /api/friends/search?query=.*
# Returns all users (regex bypass)

GET /api/friends/search?query=^admin
# Enumerate usernames starting with 'admin'

GET /api/friends/search?query={"$ne": null}
# Attempt object injection (mitigated by express-validator but still risky)
```

**Impact:**
- Information disclosure (enumerate all usernames and emails)
- Bypass search restrictions
- Potential for ReDoS (Regular Expression Denial of Service)

**Remediation:**
The notes service already implements this correctly. Apply the same pattern:

```javascript
// Use existing escapeRegex function from notesService
const { escapeRegex } = require('../services/notesService');

router.get('/search', async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === '') {
      return res.json([]);
    }

    // Escape regex special characters
    const escapedQuery = escapeRegex(query.trim());

    let users;
    if (req.user.isAdmin) {
      users = await User.find({
        $or: [
          { username: { $regex: escapedQuery, $options: 'i' } },
          { email: { $regex: escapedQuery, $options: 'i' } }
        ],
        _id: { $ne: req.user._id }
      }).select('username email').limit(10);
    }
    // ...
  }
});
```

**Note:** The `notesService.js:15-16` already implements proper regex escaping - reuse this across the codebase.

---

## HIGH Severity Vulnerabilities

### 4. CORS Wildcard Configuration Allows Any Origin

**Severity:** HIGH
**CVSS Score:** 7.4 (High)
**Location:** `server/server.js:34-37`
**CWE:** CWE-942 (Overly Permissive CORS Policy)

**Description:**
The CORS configuration allows setting `ALLOWED_ORIGINS=*` which, combined with `credentials: true`, creates a dangerous configuration that can lead to credential theft.

**Vulnerable Code:**
```javascript
// server/server.js:34-37
const corsOptions = {
  origin: function (origin, callback) {
    // If ALLOWED_ORIGINS is set to '*', allow all origins
    if (allowedOrigins.includes('*')) {
      return callback(null, true);  // DANGEROUS WITH credentials: true
    }
```

**Attack Vector:**
1. Admin sets `ALLOWED_ORIGINS=*` for "convenience"
2. Attacker hosts malicious site at `https://evil.com`
3. Attacker's JavaScript makes authenticated requests:
```javascript
fetch('https://victim-keeplocal.com/api/notes', {
  credentials: 'include',
  headers: { 'Authorization': 'Bearer ...' }
})
.then(r => r.json())
.then(notes => sendToAttacker(notes));
```
4. Browser includes authentication cookies/tokens
5. Attacker steals all notes and user data

**Impact:**
- Cross-Site Request Forgery (CSRF) bypass
- Session hijacking
- Data exfiltration
- Authentication token theft

**Remediation:**
```javascript
const corsOptions = {
  origin: function (origin, callback) {
    // NEVER allow wildcard with credentials
    if (allowedOrigins.includes('*')) {
      console.error('ERROR: CORS wildcard (*) is not allowed with credentials: true');
      return callback(new Error('Dangerous CORS configuration detected'));
    }

    // ... rest of validation
  },
  credentials: true,
  optionsSuccessStatus: 200
};
```

**Additional Recommendations:**
- Remove the wildcard option entirely from documentation
- Add startup validation to prevent `*` in production
- Document proper CORS configuration in README

---

### 5. Missing Input Validation on Share Endpoints

**Severity:** HIGH
**CVSS Score:** 7.1 (High)
**Location:** `server/routes/notes.js:144-177`
**CWE:** CWE-20 (Improper Input Validation)

**Description:**
The note sharing endpoints (`/api/notes/:id/share` and `/api/notes/:id/share/:userId`) lack input validation middleware, potentially allowing malformed or malicious data to reach the service layer.

**Vulnerable Code:**
```javascript
// server/routes/notes.js:144-158 - NO VALIDATION
router.post('/:id/share', async (req, res, next) => {
  try {
    const { userId: targetUserId } = req.body;  // UNVALIDATED
    const note = await notesService.shareNote(
      req.params.id,
      req.user._id,
      targetUserId
    );
```

```javascript
// server/routes/notes.js:164-177 - NO VALIDATION
router.delete('/:id/share/:userId', async (req, res, next) => {
  try {
    const note = await notesService.unshareNote(
      req.params.id,          // NOT VALIDATED as MongoID
      req.user._id,
      req.params.userId       // NOT VALIDATED as MongoID
    );
```

**Attack Vector:**
```bash
POST /api/notes/valid-note-id/share
{
  "userId": {"$ne": null}  # Object injection attempt
}

DELETE /api/notes/../admin/valid-note-id/share/invalid-id
# Path traversal attempt (mitigated by Express but still risky)
```

**Impact:**
- Application errors and crashes
- Potential NoSQL injection if service layer doesn't validate
- Information disclosure through error messages
- Unexpected behavior

**Remediation:**
```javascript
// Add validation middleware
const shareValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid note ID'),
  body('userId')
    .isMongoId()
    .withMessage('Invalid user ID'),
  handleValidationErrors
];

const unshareValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid note ID'),
  param('userId')
    .isMongoId()
    .withMessage('Invalid user ID'),
  handleValidationErrors
];

router.post('/:id/share', shareValidation, async (req, res, next) => {
  // ... existing code
});

router.delete('/:id/share/:userId', unshareValidation, async (req, res, next) => {
  // ... existing code
});
```

---

## MEDIUM Severity Vulnerabilities

### 6. Information Disclosure Through Debug Logging

**Severity:** MEDIUM
**CVSS Score:** 5.3 (Medium)
**Location:** Multiple files
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

**Description:**
The application logs sensitive data to console in production environments, including request bodies, validation errors, and user data. This information could be accessible through log aggregation systems, container logs, or file system access.

**Vulnerable Locations:**

1. **Request Body Logging:**
```javascript
// server/routes/notes.js:60-62
console.log('=== POST /api/notes REQUEST BODY ===');
console.log(JSON.stringify(req.body, null, 2));
console.log('===================================');
```

2. **Validation Error Logging:**
```javascript
// server/middleware/validators.js:7-10
console.log('=== VALIDATION ERRORS ===');
console.log('Request Body:', JSON.stringify(req.body, null, 2));
console.log('Validation Errors:', JSON.stringify(errors.array(), null, 2));
console.log('========================');
```

3. **Multiple Error Handlers:** 22 total console.log/error statements across 7 files

**Impact:**
- Exposure of sensitive note content in logs
- Password exposure during validation errors
- Email addresses and usernames in logs
- API tokens in request headers
- Compliance violations (GDPR, HIPAA if applicable)

**Remediation:**

1. **Implement Proper Logging:**
```javascript
// server/utils/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;
```

2. **Sanitize Logged Data:**
```javascript
function sanitizeForLogging(data) {
  const sanitized = { ...data };
  const sensitiveFields = ['password', 'token', 'secret', 'authorization'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}
```

3. **Remove Debug Logs:**
   - Remove `notes.js:60-62` (request body logging)
   - Remove `validators.js:7-10` (validation error logging)
   - Replace all `console.log/error` with proper logger

---

### 7. Inconsistent Password Validation Requirements

**Severity:** MEDIUM
**CVSS Score:** 4.8 (Medium)
**Location:** `server/routes/admin.js:44` vs `server/models/User.js:25`
**CWE:** CWE-521 (Weak Password Requirements)

**Description:**
Inconsistent password requirements between admin user creation and regular registration allow admins to create users with weak 6-character passwords, while regular registration requires 8 characters with complexity rules.

**Vulnerable Code:**

**Admin Route (Weak):**
```javascript
// server/routes/admin.js:44
if (password.length < 6) {
  return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
}
```

**User Registration (Strong):**
```javascript
// server/routes/auth.js:74-78
body('password')
  .isLength({ min: 8 })
  .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .withMessage('Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten'),
```

**User Model:**
```javascript
// server/models/User.js:25
minlength: [8, 'Passwort muss mindestens 8 Zeichen lang sein']
```

**Impact:**
- Admins can create weak passwords for users
- Users created by admins more susceptible to brute force
- Inconsistency creates security confusion
- Bypasses intended password policy

**Remediation:**
```javascript
// server/routes/admin.js - Apply same validation as registration
router.post('/users', [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Benutzername muss zwischen 3 und 50 Zeichen lang sein')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Ungültige E-Mail-Adresse')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Passwort muss mindestens 8 Zeichen lang sein')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten'),

  handleValidationErrors
], async (req, res) => {
  // ... existing code (remove manual password validation)
```

---

## LOW Severity Vulnerabilities

### 8. Potentially Insufficient Rate Limiting

**Severity:** LOW
**CVSS Score:** 3.7 (Low)
**Location:** `server/server.js:61-67`
**CWE:** CWE-770 (Allocation of Resources Without Limits or Throttling)

**Description:**
The global rate limit allows 100 requests per 15 minutes per IP, which may be insufficient to prevent credential stuffing, brute force attacks, or API abuse.

**Current Configuration:**
```javascript
// server/server.js:61-67
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per IP
  message: 'Zu viele Anfragen von dieser IP, bitte versuchen Sie es später erneut.',
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Issues:**
- 100 requests allows ~6-7 login attempts per minute
- No separate, stricter limit for authentication endpoints
- IP-based limiting easily bypassed with proxies/VPNs
- No account lockout mechanism

**Impact:**
- Credential stuffing attacks
- Brute force password guessing
- API abuse and resource exhaustion
- Account enumeration

**Remediation:**

1. **Implement Stricter Auth Limits:**
```javascript
// Stricter limit for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 5,                      // 5 attempts per 15 minutes
  message: 'Zu viele Login-Versuche. Bitte versuchen Sie es später erneut.',
  skipSuccessfulRequests: true
});

// Apply to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
```

2. **Implement Account Lockout:**
```javascript
// Add to User model
const userSchema = new mongoose.Schema({
  // ... existing fields
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date }
});

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };
  const needsLock = this.loginAttempts + 1 >= 5;

  if (needsLock && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }

  return this.updateOne(updates);
};
```

3. **Consider Additional Protections:**
- Implement CAPTCHA after 3 failed attempts
- Monitor for distributed brute force attacks
- Add exponential backoff for repeated failures
- Implement device fingerprinting for suspicious activity

---

## Security Best Practices Already Implemented ✅

The application demonstrates several security best practices:

1. **CSRF Protection:** Properly implemented with `csurf` middleware on state-changing routes
2. **Security Headers:** Helmet.js configured with Content Security Policy
3. **XSS Protection:**
   - Server-side: `xss` library sanitization
   - Client-side: DOMPurify sanitization
   - Proper use of `sanitizeAndLinkify()` before `dangerouslySetInnerHTML`
4. **Password Security:**
   - bcrypt hashing with salt rounds of 10
   - Passwords excluded from JSON serialization
5. **Input Validation:** express-validator on most endpoints
6. **NoSQL Injection Prevention:** Proper regex escaping in notes service
7. **Authentication:** Stateless JWT with expiration
8. **Authorization:** Proper ownership checks in service layer
9. **Compression:** Gzip enabled for responses
10. **Environment Variables:** Secrets managed through .env (example provided)
11. **Docker Security:** Multi-stage builds, non-root user consideration

---

## Recommendations Summary

### Immediate Actions (Critical Priority)

1. **Fix SSRF Vulnerability:** Implement URL whitelist/blacklist for link preview feature
2. **Enforce Strong JWT Secret:** Add startup validation requiring secure JWT_SECRET
3. **Fix NoSQL Injection:** Implement regex escaping in friends search endpoint
4. **Remove CORS Wildcard:** Prevent `ALLOWED_ORIGINS=*` in production
5. **Add Share Endpoint Validation:** Implement input validation on share routes

### Short-term Actions (1-2 weeks)

6. **Implement Proper Logging:** Replace console.log with structured logging library
7. **Standardize Password Requirements:** Apply consistent validation across all user creation
8. **Enhance Rate Limiting:** Implement stricter limits for authentication endpoints
9. **Add Account Lockout:** Prevent brute force attacks on user accounts
10. **Security Testing:** Conduct penetration testing on fixed vulnerabilities

### Long-term Actions

11. **Security Monitoring:** Implement intrusion detection and alerting
12. **Regular Audits:** Schedule quarterly security assessments
13. **Dependency Scanning:** Automate dependency vulnerability scanning in CI/CD
14. **Security Headers:** Review and enhance CSP policies
15. **Implement WAF:** Consider Web Application Firewall for production deployments

---

## Testing Recommendations

### Automated Security Testing

```bash
# Install security testing tools
npm install --save-dev snyk helmet-csp

# Run dependency audit
npm audit
npm audit fix

# Consider adding to CI/CD:
- SAST (Static Application Security Testing)
- DAST (Dynamic Application Security Testing)
- Dependency scanning (Snyk, Dependabot)
```

### Manual Testing Checklist

- [ ] Test SSRF with internal URLs (localhost, 169.254.169.254)
- [ ] Verify JWT secret enforcement on startup
- [ ] Test NoSQL injection in search endpoints
- [ ] Verify CORS configuration blocks wildcard
- [ ] Test rate limiting on authentication endpoints
- [ ] Verify XSS protection in note content
- [ ] Test authorization on all endpoints (IDOR)
- [ ] Verify CSRF protection on state-changing operations

---

## Conclusion

KeepLocal demonstrates a solid foundation of security practices but contains critical vulnerabilities that require immediate attention. The SSRF vulnerability poses the highest risk and should be addressed urgently. The weak JWT secret fallback could lead to complete system compromise if deployed without proper configuration.

The development team has shown security awareness by implementing CSRF protection, XSS sanitization, and proper password hashing. With the recommended fixes applied, KeepLocal can achieve a strong security posture suitable for production deployment.

**Overall Risk Rating:** HIGH (before remediation)
**Recommended Risk Rating:** LOW (after remediation)

---

## References

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [MongoDB Injection Prevention](https://owasp.org/www-community/attacks/NoSQL_Injection)

