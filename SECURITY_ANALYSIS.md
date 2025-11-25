# KeepLocal Security Analysis Report

**Date:** 2025-11-25
**Analyzed Version:** 2.0.0
**Analyst:** Claude Code Security Review

---

## Executive Summary

This security analysis identified **27 vulnerabilities** across the KeepLocal application:

| Severity | Count |
|----------|-------|
| **CRITICAL** | 5 |
| **HIGH** | 10 |
| **MEDIUM** | 9 |
| **LOW** | 3 |

The most critical issues involve:
1. Weak JWT secret fallback allowing token forgery
2. Server-Side Request Forgery (SSRF) in link preview
3. NoSQL injection via regex in user search
4. Debug endpoint exposing all user uploads
5. Data integrity issue in user deletion

---

## Critical Vulnerabilities

### 1. Weak JWT Secret with Insecure Default Fallback

**File:** `server/middleware/auth.js:5-6`
**Severity:** CRITICAL
**CVSS Score:** 9.8

```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
```

**Issue:** If `JWT_SECRET` environment variable is not set, it falls back to a predictable hardcoded string. An attacker who knows this secret can forge valid JWT tokens and impersonate any user.

**Impact:** Complete authentication bypass, full account takeover

**Recommendation:**
```javascript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
  process.exit(1);
}
```

---

### 2. Server-Side Request Forgery (SSRF) in Link Preview

**File:** `server/utils/linkPreview.js:10-70`
**Route:** `POST /api/notes/link-preview`
**Severity:** CRITICAL
**CVSS Score:** 8.6

```javascript
async function fetchLinkPreview(url) {
  const parsedUrl = new URL(url);  // Only validates URL format
  const protocol = parsedUrl.protocol === 'https:' ? https : http;
  // NO VALIDATION of target host/IP
}
```

**Attack Vectors:**
- `http://localhost:5000/api/admin/users` - Access internal admin API
- `http://127.0.0.1:27017` - Probe MongoDB
- `http://169.254.169.254/latest/meta-data/` - AWS metadata theft
- `http://192.168.1.1` - Internal network scanning

**Impact:** Internal network reconnaissance, cloud metadata theft, potential RCE

**Recommendation:**
```javascript
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

async function isPrivateIP(hostname) {
  const addresses = await dns.resolve4(hostname);
  return addresses.some(addr => {
    const parsed = ipaddr.parse(addr);
    return parsed.range() !== 'unicast' ||
           ['private', 'loopback', 'linkLocal', 'uniqueLocal'].includes(parsed.range());
  });
}

// Block private IPs, localhost, and metadata endpoints
const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '::1'];
if (blockedHosts.includes(parsedUrl.hostname) || await isPrivateIP(parsedUrl.hostname)) {
  throw new Error('Access to internal resources is not allowed');
}
```

---

### 3. NoSQL Injection via Regex in User Search

**File:** `server/routes/friends.js:180-181, 189-190`
**Severity:** CRITICAL
**CVSS Score:** 8.1

```javascript
users = await User.find({
  $or: [
    { username: { $regex: query, $options: 'i' } },  // Unsanitized regex
    { email: { $regex: query, $options: 'i' } }
  ]
});
```

**Attack:** `GET /api/friends/search?query=.*` returns all users

**Impact:** User enumeration, information disclosure, ReDoS attacks

**Recommendation:**
```javascript
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const sanitizedQuery = escapeRegex(query);
users = await User.find({
  $or: [
    { username: { $regex: sanitizedQuery, $options: 'i' } },
    { email: { $regex: sanitizedQuery, $options: 'i' } }
  ]
});
```

---

### 4. Debug Endpoint Exposes All User Uploads

**File:** `server/routes/notes.js:332-373`
**Route:** `GET /api/notes/debug/uploads`
**Severity:** CRITICAL
**CVSS Score:** 7.5

```javascript
router.get('/debug/uploads', async (req, res) => {
  const uploadsDir = path.join(__dirname, '../uploads/images');
  const files = fs.readdirSync(uploadsDir);  // Lists ALL files
  // Returns filenames, sizes, timestamps for EVERY upload
});
```

**Impact:** Any authenticated user can enumerate all uploaded files from all users

**Recommendation:** Remove this endpoint entirely or restrict to admin with additional authentication:
```javascript
// DELETE THIS ENDPOINT IN PRODUCTION
// Or if needed for debugging:
router.get('/debug/uploads', isAdmin, async (req, res) => { ... });
```

---

### 5. Field Mismatch Causes Orphaned Data on User Deletion

**File:** `server/routes/admin.js:159`
**Severity:** CRITICAL
**CVSS Score:** 7.1

```javascript
// BUG: Note model uses 'userId', not 'user'
await Note.deleteMany({ user: id });  // WRONG - silently deletes nothing
```

**Impact:** When admin deletes a user, their notes remain in database (orphaned data, privacy violation)

**Recommendation:**
```javascript
await Note.deleteMany({ userId: id });  // Correct field name
```

---

## High Severity Vulnerabilities

### 6. JWT Tokens Stored in localStorage (XSS Risk)

**File:** `client/src/services/api/apiUtils.js:30-39`
**Severity:** HIGH

```javascript
export function setAuthToken(token) {
  localStorage.setItem('token', token);  // Accessible via XSS
}
```

**Impact:** Any XSS vulnerability allows token theft

**Recommendation:** Use httpOnly cookies instead of localStorage for token storage.

---

### 7. Recursive Object Sanitization Missing in Arrays

**File:** `server/utils/sanitize.js:47-49`
**Severity:** HIGH

```javascript
sanitized[key] = obj[key].map(item =>
  typeof item === 'string' ? sanitizeInput(item) : item  // Objects not sanitized!
);
```

**Impact:** Nested objects in arrays (like `linkPreviews`, `todoItems`) bypass XSS sanitization

**Recommendation:**
```javascript
sanitized[key] = obj[key].map(item => {
  if (typeof item === 'string') return sanitizeInput(item);
  if (typeof item === 'object' && item !== null) return sanitizeObject(item);
  return item;
});
```

---

### 8. Path Traversal in Secure File Serve

**File:** `server/middleware/secureFileServe.js:12, 41`
**Severity:** HIGH

```javascript
const filename = req.params[0];  // From URL
const filepath = path.join(__dirname, '../uploads', filename);  // No canonical check
```

**Impact:** Potential directory escape with `../` sequences

**Recommendation:**
```javascript
const filepath = path.join(__dirname, '../uploads', filename);
const realPath = path.resolve(filepath);
const uploadsDir = path.resolve(path.join(__dirname, '../uploads'));

if (!realPath.startsWith(uploadsDir + path.sep)) {
  return res.status(403).json({ error: 'Invalid file path' });
}
```

---

### 9. No Magic Number Validation for Audio Files

**File:** `server/middleware/upload.js:52-59`
**Severity:** HIGH

```javascript
const audioFileFilter = (req, file, cb) => {
  const allowedTypes = /audio\/mpeg|audio\/wav|.../;
  if (allowedTypes.test(file.mimetype)) {  // ONLY checks MIME type
    return cb(null, true);
  }
};
```

**Impact:** Malicious files can be uploaded with spoofed MIME types

**Recommendation:** Implement magic number validation for audio files similar to image validation.

---

### 10. Race Condition in Friend Request Accept

**File:** `server/routes/friends.js:87-116`
**Severity:** HIGH

```javascript
await user.save();        // First save
const requester = await User.findById(request.from);
await requester.save();   // Second save - no transaction!
```

**Impact:** Concurrent requests can corrupt friend relationships

**Recommendation:** Use MongoDB transactions (already implemented in service layer - use `friendsService.acceptFriendRequest()` instead).

---

### 11. Deprecated Mongoose Method

**File:** `server/routes/friends.js:134`
**Severity:** HIGH

```javascript
request.remove();  // Deprecated in Mongoose 6+
```

**Recommendation:**
```javascript
user.friendRequests.pull(req.params.requestId);
```

---

### 12. CORS Allows Requests Without Origin Header

**File:** `server/server.js:34`
**Severity:** HIGH

```javascript
if (!origin) return callback(null, true);  // Allows no-origin requests
```

**Impact:** CORS bypass for non-browser clients

**Recommendation:**
```javascript
if (!origin) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return callback(new Error('Origin required'), false);
  }
  return callback(null, true);
}
```

---

### 13. Inconsistent Password Requirements

**Files:** `server/routes/auth.js:74-78` vs `server/routes/admin.js:44-46`
**Severity:** HIGH

- Registration: 8+ chars with uppercase, lowercase, digit
- Admin creation: 6+ chars with no complexity

**Recommendation:** Apply consistent password policy across all endpoints.

---

### 14. User Enumeration via Login Timing

**File:** `server/routes/auth.js:168-180`
**Severity:** HIGH

```javascript
const user = await User.findOne({ email });  // Fast if not found
const isPasswordValid = await user.comparePassword(password);  // Slow bcrypt
```

**Impact:** Timing differences reveal valid email addresses

**Recommendation:** Always perform bcrypt comparison even for non-existent users:
```javascript
const user = await User.findOne({ email });
const dummyHash = '$2a$10$dummy.hash.for.timing.attack.prevention';
const isPasswordValid = await bcrypt.compare(password, user?.password || dummyHash);
if (!user || !isPasswordValid) {
  return res.status(401).json({ error: 'Invalid credentials' });
}
```

---

### 15. CORS Wildcard Configuration

**File:** `server/server.js:36-39`
**Severity:** HIGH

```javascript
if (allowedOrigins.includes('*')) {
  return callback(null, true);  // Allows ALL origins
}
```

**Impact:** If `ALLOWED_ORIGINS=*`, CORS protection is completely disabled

**Recommendation:** Never allow wildcard in production, or at minimum warn loudly:
```javascript
if (allowedOrigins.includes('*')) {
  if (process.env.NODE_ENV === 'production') {
    console.error('WARNING: CORS wildcard in production is insecure!');
  }
  return callback(null, true);
}
```

---

## Medium Severity Vulnerabilities

### 16. No Token Revocation Mechanism

**File:** `server/middleware/auth.js:8-11`
**Severity:** MEDIUM

JWT tokens cannot be revoked - stolen tokens valid for 7 days.

**Recommendation:** Implement token blacklist or use shorter-lived tokens with refresh tokens.

---

### 17. CSRF Token Lost on Page Reload

**File:** `client/src/services/api/apiUtils.js:6-7`
**Severity:** MEDIUM

CSRF token stored only in memory, lost on page refresh.

**Recommendation:** Re-fetch CSRF token on page load or use session-based CSRF.

---

### 18. HTTP Origins Allowed in Production

**File:** `server/server.js:43-50`
**Severity:** MEDIUM

HTTP (unencrypted) private IP origins are whitelisted.

**Recommendation:** Enforce HTTPS in production environments.

---

### 19. Auth Endpoints Skip CSRF Protection

**File:** `server/server.js:115-116`
**Severity:** MEDIUM

Registration endpoint vulnerable to CSRF attacks.

**Recommendation:** Add CSRF protection to registration or implement other mitigations.

---

### 20. Weak Extension Validation Regex

**File:** `server/middleware/upload.js:40-42`
**Severity:** MEDIUM

```javascript
const allowedTypes = /jpeg|jpg|png|gif|webp/;
const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
```

`file.jpg.exe` would pass validation.

**Recommendation:** Use strict extension matching:
```javascript
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ext = path.extname(file.originalname).toLowerCase();
if (!allowedExtensions.includes(ext)) { ... }
```

---

### 21. Missing Validation on Archive/Share Endpoints

**Files:** `server/routes/notes.js:127-137, 142-157`
**Severity:** MEDIUM

No express-validator middleware on these routes.

**Recommendation:** Add validation middleware consistent with other endpoints.

---

### 22. High Global Rate Limit

**File:** `server/server.js:64-70`
**Severity:** MEDIUM

500 requests per 15 minutes may not prevent brute force.

**Recommendation:** Add endpoint-specific rate limits for login, registration, and search.

---

### 23. Missing Parameter Validation on Admin Routes

**File:** `server/routes/admin.js:146, 181`
**Severity:** MEDIUM

`:id` parameters not validated as MongoDB ObjectIds.

**Recommendation:** Add `param('id').isMongoId()` validation.

---

### 24. Potential File Overwrite Race Condition

**File:** `server/routes/notes.js:254`
**Severity:** MEDIUM

No collision check before `fs.renameSync()`.

**Recommendation:** Check file existence before rename or use unique identifiers.

---

## Low Severity Vulnerabilities

### 25. Account Enumeration via Registration

**File:** `server/routes/auth.js:107-118`
**Severity:** LOW

Different error messages for existing email vs username.

**Recommendation:** Use generic error message.

---

### 26. Silent Error Handling in Optional Auth

**File:** `server/middleware/auth.js:51-70`
**Severity:** LOW

Invalid tokens silently ignored without logging.

**Recommendation:** Log invalid token attempts for security monitoring.

---

### 27. Weak JWT Secret Examples in Documentation

**Files:** `.env.example`
**Severity:** LOW

Example secrets are not cryptographically random.

**Recommendation:** Document requirement for 32+ bytes of cryptographic randomness.

---

## Positive Security Features

The application implements several good security practices:

- **Password Hashing:** bcrypt with proper salt rounds
- **XSS Protection:** DOMPurify on client, xss library on server
- **Input Validation:** express-validator on most endpoints
- **Security Headers:** Helmet.js with CSP, X-Frame-Options, etc.
- **Rate Limiting:** Global rate limiter in place
- **CSRF Protection:** csurf middleware on state-changing routes
- **File Type Validation:** Magic number validation for images
- **Authentication:** JWT-based authentication
- **Authorization:** Owner/shared access checks on notes
- **Password Exclusion:** Passwords excluded from JSON responses

---

## Recommended Priority Actions

### Immediate (P0)
1. Require JWT_SECRET environment variable (no fallback)
2. Fix SSRF vulnerability in link preview
3. Fix NoSQL injection in user search
4. Remove or protect debug endpoint
5. Fix user deletion field mismatch

### Short-term (P1)
1. Add path traversal protection to file serving
2. Implement audio file magic number validation
3. Use transactions in friend routes (use service layer)
4. Enforce consistent password policies
5. Fix recursive sanitization for arrays

### Medium-term (P2)
1. Migrate JWT storage to httpOnly cookies
2. Implement token revocation mechanism
3. Add endpoint-specific rate limiting
4. Add validation to archive/share endpoints
5. Implement timing-safe user lookup

---

## Improvement Recommendations

### Code Quality
1. **Use service layer consistently:** Routes should call services rather than implementing business logic directly
2. **Add integration tests:** Security-focused tests for auth, authorization, file uploads
3. **Implement request logging:** Log authentication attempts and suspicious activity
4. **Add health check authentication:** Consider protecting health endpoints in production

### Architecture
1. **Consider Redis for sessions:** Enable token revocation and session management
2. **Add CSP reporting:** Monitor Content-Security-Policy violations
3. **Implement audit logging:** Track admin actions and sensitive operations
4. **Add request ID tracing:** For debugging and security incident response

### DevOps
1. **Secrets management:** Use proper secrets manager instead of .env files
2. **Container security:** Run containers as non-root user
3. **Dependency scanning:** Add automated vulnerability scanning for npm packages
4. **Security headers review:** Regularly audit Helmet.js configuration

---

*This analysis was performed on the codebase as of 2025-11-25. Security is an ongoing process - regular reviews are recommended.*
