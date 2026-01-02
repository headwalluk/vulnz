# Architecture Overview

High-level architecture and request flow for VULNZ.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Browser │  │    CLI   │  │ WP Plugin│  │  Script  │   │
│  │  (Human) │  │  (Admin) │  │ (Website)│  │ (Cron)   │   │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘   │
└────────┼─────────────┼─────────────┼─────────────┼─────────┘
         │             │             │             │
         │ HTTP/HTML   │ Commands    │ HTTP/JSON   │ HTTP/JSON
         │             │             │             │
         ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Express.js (Node.js v22)                │   │
│  │                                                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │  Static  │  │ Sessions │  │   CORS   │          │   │
│  │  │  Files   │  │  Auth    │  │  Helmet  │          │   │
│  │  └──────────┘  └──────────┘  └──────────┘          │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │         Middleware Chain                       │ │   │
│  │  │  • Rate Limiting (unauthenticated requests)    │ │   │
│  │  │  • Authentication (session or API key)         │ │   │
│  │  │  • Role Check (admin/user)                     │ │   │
│  │  │  • API Call Logging                            │ │   │
│  │  │  • Request Validation                          │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              Route Handlers                    │ │   │
│  │  │  /api/auth     - Login, register, logout       │ │   │
│  │  │  /api/users    - User management               │ │   │
│  │  │  /api/websites - Website CRUD                  │ │   │
│  │  │  /api/components - Component search            │ │   │
│  │  │  /doc          - Swagger API docs              │ │   │
│  │  │  /              - Public search interface      │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              Business Logic                    │ │   │
│  │  │  • Models (database queries)                   │ │   │
│  │  │  • Libraries (email, sanitization, etc.)       │ │   │
│  │  │  • Scheduled Tasks (cron jobs)                 │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │
         │ SQL Queries
         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  MySQL/MariaDB   │  │  Sessions Store  │                │
│  │  (Main Database) │  │  (MySQL-backed)  │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
         │
         │ Backups (mysqldump)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backup Storage                            │
│                     (File System)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Flow

### 1. Public Search (Unauthenticated)

```
User → HTTP GET /api/components/search?query=woocommerce
  ↓
Rate Limiting Middleware (per-IP, unauthenticated limit)
  ↓
Optional Auth Middleware (allows anonymous)
  ↓
API Call Logging
  ↓
Route Handler
  ↓
Model.search(query) → Database Query
  ↓
JSON Response ← Results
```

### 2. API Request (Authenticated with API Key)

```
Client → HTTP POST /api/websites
  Headers: X-API-Key: abc123
  Body: { domain: "example.com", title: "My Site" }
  ↓
API Key Authentication (passport-headerapikey)
  ↓
User Lookup & Block Check
  ↓
API Call Logging (with user_id)
  ↓
Input Validation & Sanitization
  ↓
Route Handler
  ↓
Model.create(data) → Database INSERT
  ↓
JSON Response ← { id: 123, domain: "example.com" }
```

### 3. Web UI Request (Session Authenticated)

```
Browser → HTTP GET /dashboard
  Cookies: connect.sid=xyz789
  ↓
Session Middleware (express-session)
  ↓
Passport Deserialization (load user from session)
  ↓
isAuthenticatedPage Middleware
  ↓
Serve Static HTML + JavaScript
  ↓
JavaScript makes API calls (with session cookies)
```

### 4. Admin Request (Role-Based Access)

```
User → HTTP GET /api/admin/users
  ↓
API Key or Session Authentication
  ↓
User Role Lookup (JOIN user_roles, roles)
  ↓
hasRole('administrator') Middleware
  ↓
Route Handler
  ↓
Admin Action (e.g., list all users)
  ↓
JSON Response
```

---

## Authentication & Authorization

### Authentication Methods

1. **Session-based** (Web UI)
   - Login via username/password
   - Session stored in MySQL
   - Managed by `express-session` + `passport-local`
   - Cookie: `connect.sid`

2. **API Key** (Programmatic access)
   - Generated via UI or CLI (future)
   - Header: `X-API-Key: your-key-here`
   - Managed by `passport-headerapikey`
   - Maps to user account

3. **Hybrid** (Most API endpoints)
   - Accept either session OR API key
   - Middleware: `apiOrSessionAuth`

### Authorization Flow

```
Request
  ↓
Authenticate (session or API key) → req.user populated
  ↓
Check user.blocked? → 401 Unauthorized
  ↓
Check user.paused? → 401 Unauthorized (for session auth)
  ↓
Check role (if required)
  ↓
  ├─ administrator → Full access
  └─ user → Limited to own resources
  ↓
Resource Access Check
  ↓
  ├─ Own resource? → Allow
  ├─ Admin? → Allow
  └─ Other user's resource? → 403 Forbidden
```

### Middleware Stack

```javascript
// Public endpoint (no auth required)
router.get('/api/components/search', logApiCall, handler);

// User endpoint (auth required, access own resources)
router.get('/api/websites', apiOrSessionAuth, logApiCall, handler);

// Admin endpoint (auth + admin role required)
router.get('/api/admin/users', apiKeyOrSessionAdminAuth, logApiCall, handler);

// Web page (session required, redirect to login if not authenticated)
router.get('/dashboard', isAuthenticatedPage, handler);
```

---

## Data Flow Patterns

### Creating a Website

```
1. Client sends POST /api/websites
   Body: { domain: "example.com", title: "My Site" }

2. Middleware chain:
   - apiOrSessionAuth → validates user
   - logApiCall → logs request

3. Route handler:
   - Validate input (domain, title present)
   - Sanitize input (strip HTML, decode entities)
   - Check for duplicates (user_id + domain unique)

4. Model layer:
   - Website.create({ user_id, domain, title, meta })
   - Execute INSERT query with parameter binding
   - Return inserted ID

5. Response:
   - 201 Created
   - JSON: { id: 123, domain: "example.com", ... }
```

### Vulnerability Check

```
1. Website updates its component list via API

2. For each component:
   - Find or create Component record
   - Find or create Release record
   - Update website_components junction table

3. Weekly report generation (cron job):
   - Query: SELECT websites with vulnerabilities
   - For each website:
     - Get components with vulnerabilities
     - Generate email from Handlebars template
     - Send via nodemailer (SMTP)
     - Log in email_logs table
```

---

## Scheduled Tasks

VULNZ uses `node-cron` for scheduled background tasks.

### Weekly Vulnerability Reports

```javascript
// Runs every day at 00:00
cron.schedule('0 0 * * *', async () => {
  await sendWeeklyReports();
});
```

**Process:**
1. Query users with `reporting_weekday` matching current day
2. Filter by `reporting_hour` matching current hour
3. For each user:
   - Find websites with vulnerabilities
   - Generate HTML email from template
   - Send email
   - Update `last_summary_sent_at`

### WordPress.org Metadata Sync

```javascript
// Runs every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  await syncNextPlugin();
});
```

**Process:**
1. Get cursor from `app_settings` table
2. Fetch next component from local database
3. Query wordpress.org API for metadata
4. Update component with metadata
5. Update cursor for next run

---

## Session Management

### Storage

Sessions stored in MySQL via `express-mysql-session`:

```javascript
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
```

### Session Lifecycle

1. **Login**: User provides username/password
   - Passport verifies credentials
   - Session created in database
   - Session ID sent as cookie (`connect.sid`)

2. **Subsequent Requests**: Browser sends cookie
   - express-session loads session from database
   - Passport deserializes user (loads from database)
   - `req.user` populated with user object

3. **Logout**: User clicks logout
   - Session destroyed in database
   - Cookie cleared from browser

### Session Security

- `httpOnly: true` - Prevents JavaScript access
- `secure: true` - HTTPS only (production)
- `sameSite: 'strict'` - CSRF protection
- Secret from environment variable

---

## Email System

### Email Flow

```
Trigger (weekly report, password reset, test email)
  ↓
Prepare email data
  ↓
Load Handlebars template
  ↓
Compile template with data
  ↓
Apply white-label customization (if enabled)
  ↓
Sanitize HTML (XSS prevention)
  ↓
Send via nodemailer (SMTP)
  ↓
Log result in email_logs table
```

### Templates

Located in `src/emails/`:
- `vulnerability-report.hbs` - Weekly vulnerability summary
- `password-reset.hbs` - Password reset link

### White-Label Support

Users can customize email header:
- `enable_white_label`: boolean flag
- `white_label_html`: custom HTML (max 16KB)
- HTML sanitized before sending
- Supports inline SVG for logos

---

## Security Layers

### Input Validation

```
User Input
  ↓
Type Check (typeof, instanceof)
  ↓
Required Field Check
  ↓
Format Validation (email, domain, version)
  ↓
Sanitization (strip HTML, decode entities)
  ↓
Database Storage (parameterized queries)
```

### SQL Injection Prevention

- **Always use parameterized queries**:
  ```javascript
  // SAFE
  db.query('SELECT * FROM users WHERE id = ?', [userId]);
  
  // DANGEROUS (never do this)
  db.query(`SELECT * FROM users WHERE id = ${userId}`);
  ```

### XSS Prevention

- **HTML Sanitization**:
  - `sanitizer.stripAll()` for plain text fields
  - `htmlSanitizer.sanitizeEmailHtml()` for email templates
  - Allow specific tags and attributes only

### Rate Limiting

- Unauthenticated search: configurable per-second limit
- Authentication endpoints: aggressive rate limiting
- Authenticated API: generous limits

### CORS Configuration

- Disabled by default
- Enable for specific origins only
- Supports credentials for API key authentication

---

## Deployment Architecture

### Development

```
Developer Workstation
  ↓
npm run dev (nodemon)
  ↓
Node.js (single process)
  ↓
Serves from public/ directory
  ↓
MySQL/MariaDB (local or remote)
```

### Production

```
Linux Server
  ↓
PM2 Process Manager (cluster mode)
  ├─ Instance 1
  ├─ Instance 2
  ├─ Instance 3
  └─ Instance N
  ↓
Node.js (multiple processes)
  ↓
Serves from dist/ directory (built assets)
  ↓
MySQL/MariaDB (separate server recommended)
  ↓
Reverse Proxy (Nginx/Apache)
  ├─ SSL/TLS Termination
  ├─ Static Asset Caching
  └─ Load Balancing
  ↓
Internet
```

---

## Error Handling

### Async Error Pattern

```javascript
router.get('/api/endpoint', async (req, res) => {
  try {
    const result = await someAsyncOperation();
    res.json(result);
  } catch (err) {
    console.error('Operation failed:', err);
    res.status(500).send('Server error');
  }
});
```

### Uncaught Exception Handler

```javascript
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1); // Exit and let PM2 restart
});
```

---

## Monitoring & Logging

### API Call Logs

Every API request logged to `api_call_logs`:
- User ID (if authenticated)
- HTTP method and path
- Status code
- IP address
- User agent
- Timestamp

### Email Logs

Every email attempt logged to `email_logs`:
- Recipient
- Subject
- Type (vulnerability-report, password-reset, etc.)
- Status (sent, failed)
- Error message (if failed)

### Application Logs

Console output (managed by PM2):
- Request logs
- Error logs
- Cron job execution logs

---

## Performance Considerations

### Database Indexes

- Unique constraints for data integrity
- Indexes on frequently queried columns
- Composite indexes for multi-column queries

### Query Optimization

- Use LIMIT/OFFSET for pagination
- Avoid N+1 queries (batch operations)
- Index foreign keys

### Caching

- Static assets cached by reverse proxy
- Session store in database (shared across instances)
- No application-level caching (keep it simple)

---

## Future Architecture (CLI + API-First)

Planned simplification:

```
┌─────────────────────────────────────────────┐
│  Public Interface: Search Only (/index)     │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  API Layer: All Operations                  │
│  (Authentication: API Key only)             │
└─────────────────────────────────────────────┘
         │
         ├─────────────────────────┐
         ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│  CLI Tool (Admin)   │   │  React SPA (Future) │
│  ./bin/vulnz        │   │  Modern UI          │
└─────────────────────┘   └─────────────────────┘
```

Benefits:
- Simpler security model (no session management for admin)
- Better automation support
- Cleaner separation of concerns
- Easier to test and maintain
