# Architecture Overview

High-level architecture and request flow for VULNZ.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │    CLI   │  │ vulnz-woo│  │ WP Plugin│  │  Script  │   │
│  │  (Admin) │  │ (WP UI)  │  │ (Website)│  │ (Cron)   │   │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘   │
└────────┼─────────────┼─────────────┼─────────────┼─────────┘
         │             │             │             │
         │ Commands    │ HTTP/JSON   │ HTTP/JSON   │ HTTP/JSON
         │             │ (API Key)   │ (API Key)   │ (API Key)
         ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Express.js (Node.js v22)                │   │
│  │                                                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │  Static  │  │  API Key │  │   CORS   │          │   │
│  │  │ (favicon)│  │   Auth   │  │  Helmet  │          │   │
│  │  └──────────┘  └──────────┘  └──────────┘          │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │         Middleware Chain                       │ │   │
│  │  │  • Rate Limiting (unauthenticated requests)    │ │   │
│  │  │  • Authentication (API key via Passport)       │ │   │
│  │  │  • Role Check (admin/user)                     │ │   │
│  │  │  • API Call Logging                            │ │   │
│  │  │  • Request Validation                          │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              Route Handlers                    │ │   │
│  │  │  /              - Status landing page          │ │   │
│  │  │  /api/users    - User management               │ │   │
│  │  │  /api/websites - Website CRUD                  │ │   │
│  │  │  /api/components - Component search            │ │   │
│  │  │  /api/vulnerabilities - Vuln bulk import       │ │   │
│  │  │  /api/releases - Release bulk import           │ │   │
│  │  │  /api/notifications - WP notification intake   │ │   │
│  │  │  /doc          - Swagger API docs              │ │   │
│  │  │  /openapi.json - Machine-readable API spec     │ │   │
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
│  ┌──────────────────┐                                        │
│  │  MySQL/MariaDB   │                                        │
│  │  (Main Database) │                                        │
│  └──────────────────┘                                        │
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

### 3. Admin Request (Role-Based Access)

```
User → HTTP GET /api/users
  Headers: X-API-Key: abc123
  ↓
API Key Authentication (passport-headerapikey)
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

### Authentication

**API Key only.** Session-based auth was removed in M10. Every authenticated request carries an `X-API-Key` header, validated by Passport's `HeaderAPIKeyStrategy` (configured in `src/config/passport.js`) against the `api_keys` table.

API keys are generated via the CLI (`vulnz key:generate <email>`) or automatically provisioned by the notification integration (`src/lib/notificationProcessor.js`) when a WordPress/WooCommerce site registers a new subscription.

### Authorization Flow

```
Request
  ↓
Authenticate (API key) → req.user populated
  ↓
Check user.blocked? → 401 Unauthorized
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
// Public endpoint (no auth required, rate-limited)
router.get('/api/components/search', unauthenticatedSearchLimiter, optionalApiAuth, logApiCall, handler);

// User endpoint (API key required)
router.get('/api/websites', apiAuth, logApiCall, handler);

// Admin endpoint (API key + admin role required)
router.get('/api/users', apiKeyAdminAuth, logApiCall, handler);
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

## Email System

### Email Flow

```
Trigger (weekly vulnerability report cron)
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

- `vulnerability-report.hbs` - Weekly vulnerability summary (sent by the weekly reporting cron)

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
MariaDB (local or remote)
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
MariaDB (separate server recommended)
  ↓
Reverse Proxy (Nginx/Apache)
  ├─ SSL/TLS Termination
  └─ Load Balancing
  ↓
Internet
```

Note: there is no build step — vulnz-api serves directly from source. The only static assets are the favicons in `public/`, served via `express.static()`.

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
- Type (vulnerability-report)
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
- No application-level caching (keep it simple)
