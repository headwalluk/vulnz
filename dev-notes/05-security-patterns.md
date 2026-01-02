# Security Patterns

Security best practices and patterns used in VULNZ.

---

## Principles

1. **Defense in Depth** - Multiple layers of security
2. **Least Privilege** - Users have minimum necessary permissions
3. **Input Validation** - Never trust user input
4. **Output Encoding** - Prevent XSS
5. **Secure by Default** - Opt-in for less secure options

---

## SQL Injection Prevention

### Always Use Parameterized Queries

**✅ GOOD - Parameterized Query:**

```javascript
const users = await db.query('SELECT * FROM users WHERE email = ?', [userEmail]);
```

**❌ BAD - String Concatenation:**

```javascript
// NEVER DO THIS
const users = await db.query(`SELECT * FROM users WHERE email = '${userEmail}'`);
```

### Dynamic WHERE Clauses

```javascript
// Build query dynamically but safely
const whereClauses = [];
const params = [];

if (userId) {
  whereClauses.push('user_id = ?');
  params.push(userId);
}

if (search) {
  whereClauses.push('domain LIKE ?');
  params.push(`%${search}%`);
}

const query = `
  SELECT * FROM websites 
  WHERE ${whereClauses.join(' AND ')} 
  ORDER BY created_at DESC
`;

const results = await db.query(query, params);
```

### Dynamic UPDATE Statements

```javascript
const updates = {};
if (req.body.title) updates.title = req.body.title;
if (req.body.domain) updates.domain = req.body.domain;

const fields = Object.keys(updates);
const values = Object.values(updates);

if (fields.length === 0) {
  return res.status(400).send('No fields to update');
}

const setClause = fields.map((field) => `${field} = ?`).join(', ');
const query = `UPDATE websites SET ${setClause} WHERE id = ?`;
const params = [...values, websiteId];

await db.query(query, params);
```

---

## Cross-Site Scripting (XSS) Prevention

### Input Sanitization

```javascript
const sanitizer = require('./lib/sanitizer');

// Strip all HTML tags and decode entities
const safeName = sanitizer.stripAll(userInput);

// Example: "<script>alert('xss')</script>" → "alertxss"
```

### HTML Sanitization for Email Templates

```javascript
const { sanitizeEmailHtml } = require('./lib/htmlSanitizer');

// Allow only safe HTML tags for email
const safeHtml = sanitizeEmailHtml(userProvidedHtml);
```

**Allowed Tags:**

- Text: `p`, `h1`-`h6`, `span`, `div`, `strong`, `em`, `b`, `i`, `u`, `br`
- Structure: `table`, `tr`, `td`, `th`, `thead`, `tbody`
- Links: `a` (with restricted `href`)
- Images: `img` (with restricted `src`)
- Inline SVG: `svg`, `path` (for logos)

**Blocked:**

- `<script>` tags
- Event handlers (`onclick`, `onerror`, etc.)
- `javascript:` URLs
- External resources (except images)

### Content Security Policy

**File**: `src/index.js`

```javascript
app.use(helmet());
// Helmet sets CSP headers automatically
```

---

## Authentication Security

### Password Hashing

```javascript
const bcrypt = require('bcrypt');

// Hash password before storing
const hashedPassword = await bcrypt.hash(plainPassword, 10);

// Verify password
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
```

**Never:**

- Store passwords in plain text
- Log passwords
- Send passwords in responses
- Hash passwords with weak algorithms (MD5, SHA1)

### Password Requirements

```javascript
const { validatePassword } = require('./lib/passwordValidation');

const result = validatePassword(password);
if (!result.isValid) {
  return res.status(400).send(result.errors.join(', '));
}
```

**Requirements:**

- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Session Security

```javascript
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true, // Prevent JavaScript access
      sameSite: 'strict', // CSRF protection
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);
```

### API Key Security

```javascript
// Generate secure random API keys
const crypto = require('crypto');
const apiKey = crypto.randomBytes(32).toString('hex');

// Store hash instead of raw key (future enhancement)
const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
```

**Best Practices:**

- Generate keys with sufficient entropy (32+ bytes)
- Never log API keys
- Allow users to revoke keys
- Consider key expiration (future enhancement)

---

## Authorization Patterns

### Resource Ownership Check

```javascript
router.get('/api/websites/:domain', apiOrSessionAuth, async (req, res) => {
  const website = await Website.findByDomain(req.params.domain);

  if (!website) {
    return res.status(404).send('Website not found');
  }

  // Check ownership or admin role
  const roles = await User.getRoles(req.user.id);
  if (website.user_id !== req.user.id && !roles.includes('administrator')) {
    return res.status(403).send('Forbidden');
  }

  // User has access
  res.json(website);
});
```

### Role-Based Access Control

```javascript
const { hasRole } = require('./middleware/auth');

// Admin-only endpoint
router.get('/api/admin/users', hasRole('administrator'), async (req, res) => {
  const users = await User.findAll();
  res.json(users);
});
```

### Middleware for Resource Access

```javascript
const canAccessWebsite = async (req, res, next) => {
  const { domain } = req.params;
  const website = await Website.findByDomain(domain);

  if (!website) {
    return res.status(404).send('Website not found');
  }

  const roles = await User.getRoles(req.user.id);
  if (website.user_id !== req.user.id && !roles.includes('administrator')) {
    return res.status(403).send('Unauthorized');
  }

  req.website = website;
  next();
};

// Use in route
router.delete('/api/websites/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  await Website.remove(req.website.id);
  res.status(204).send();
});
```

---

## Rate Limiting

### Unauthenticated Requests

```javascript
const rateLimit = require('express-rate-limit');

const searchLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: parseInt(process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND, 10) || 1,
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/api/components/search', searchLimiter, async (req, res) => {
  // Search logic
});
```

### Authentication Endpoints

```javascript
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts, please try again later',
});

router.post('/api/auth/login', authLimiter, async (req, res) => {
  // Login logic
});
```

---

## CORS Security

### Configuration

```javascript
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow requests with no origin

    const allowedOrigins = process.env.CORS_ORIGIN || '*';

    if (allowedOrigins === '*') {
      return callback(null, true);
    }

    const originsArray = allowedOrigins.split(',').map((o) => o.trim());
    if (originsArray.includes(origin)) {
      return callback(null, true);
    }

    callback(null, false); // Reject
  },
  credentials: process.env.CORS_CREDENTIALS === 'true',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
};

app.use(cors(corsOptions));
```

### Best Practices

- **Production**: Always specify exact origins
- **Development**: Use `*` only for testing
- **Credentials**: Only enable if needed (cookies, auth headers)

---

## Input Validation

### Required Fields

```javascript
router.post('/api/websites', async (req, res) => {
  const { domain, title } = req.body;

  // Check required fields
  if (!domain || !title) {
    return res.status(400).send('Domain and title are required');
  }

  // Continue processing
});
```

### Type Validation

```javascript
// Validate types
if (typeof domain !== 'string' || typeof title !== 'string') {
  return res.status(400).send('Invalid input types');
}

// Validate numbers
const limit = parseInt(req.query.limit, 10);
if (isNaN(limit) || limit < 1 || limit > 100) {
  return res.status(400).send('Invalid limit (1-100)');
}
```

### Format Validation

```javascript
// Email validation
const { isValidEmail } = require('./lib/emailValidation');
if (!isValidEmail(email)) {
  return res.status(400).send('Invalid email format');
}

// Domain validation
const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
if (!domainRegex.test(domain)) {
  return res.status(400).send('Invalid domain format');
}

// Version validation
const version = sanitizer.sanitizeVersion(versionString);
```

---

## File Upload Security

VULNZ doesn't currently handle file uploads, but if added:

```javascript
const multer = require('multer');

const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow only specific file types
    const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});
```

**Best Practices:**

- Limit file size
- Validate MIME types
- Scan for malware
- Store outside web root
- Generate random filenames
- Serve with correct Content-Type headers

---

## Environment Variable Security

### .env File Permissions

```javascript
// Automatic check on startup
const { checkEnvFilePermissions } = require('./lib/env');
checkEnvFilePermissions();
```

**Checks:**

- File permissions should be `0600` (read/write for owner only)
- Warns if world-readable or group-readable

### Sensitive Data

**Never commit to git:**

```gitignore
.env
.env.local
.env.production
```

**Generate secrets securely:**

```bash
./scripts/generate-session-secret.sh
```

---

## Error Handling Security

### Don't Leak Information

**❌ BAD - Reveals internal details:**

```javascript
catch (err) {
  res.status(500).send(err.message);
  // "ECONNREFUSED: Connection refused at 192.168.1.100:3306"
}
```

**✅ GOOD - Generic error message:**

```javascript
catch (err) {
  console.error('Database error:', err); // Log detailed error
  res.status(500).send('Server error');  // Send generic message
}
```

### Log but Don't Expose

```javascript
try {
  const user = await User.findByEmail(email);
} catch (err) {
  // Log full error for debugging
  console.error('User lookup failed:', err);

  // Send safe message to client
  res.status(500).send('An error occurred');
}
```

---

## Dependency Security

### Keep Dependencies Updated

```bash
# Check for vulnerabilities
npm audit

# Fix automatically when possible
npm audit fix

# Review package.json regularly
npm outdated
```

### Lock File

```bash
# Use package-lock.json in production
npm ci # Install from lockfile exactly
```

### Audit New Dependencies

Before adding a new package:

1. Check npm downloads and GitHub stars
2. Review recent issues and PRs
3. Check for known vulnerabilities
4. Consider package maintenance status

---

## Production Security Checklist

Before deploying:

- [ ] `SETUP_MODE=false` in production
- [ ] `REGISTRATION_ENABLED=false` (or controlled)
- [ ] Strong `SESSION_SECRET` (48+ characters)
- [ ] Database user has minimum necessary privileges
- [ ] `.env` file has `0600` permissions
- [ ] HTTPS enabled (via reverse proxy)
- [ ] `NODE_ENV=production`
- [ ] CORS restricted to specific origins
- [ ] Rate limiting enabled
- [ ] Helmet middleware enabled
- [ ] Database backups configured
- [ ] Logging configured
- [ ] Error monitoring set up
- [ ] npm audit shows no high/critical vulnerabilities

---

## Security Incident Response

If a security issue is discovered:

1. **Assess Impact**: Determine what data/systems are affected
2. **Contain**: Stop the breach (disable account, revoke keys, etc.)
3. **Investigate**: Review logs, identify root cause
4. **Fix**: Patch the vulnerability
5. **Deploy**: Update production immediately
6. **Notify**: Inform affected users if necessary
7. **Document**: Record incident and response for future reference
8. **Review**: Update security procedures to prevent recurrence

---

## Security Resources

- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **Node.js Security Best Practices**: https://nodejs.org/en/docs/guides/security/
- **Express Security Best Practices**: https://expressjs.com/en/advanced/best-practice-security.html
- **npm Security Advisories**: https://www.npmjs.com/advisories

---

## Summary

Security is built into every layer:

1. **Input** - Validate and sanitize
2. **Authentication** - Strong passwords, secure sessions, API keys
3. **Authorization** - Role-based access, resource ownership
4. **Database** - Parameterized queries, least privilege
5. **Output** - Sanitize HTML, prevent information leakage
6. **Network** - HTTPS, CORS, rate limiting
7. **Dependencies** - Regular audits, updates
