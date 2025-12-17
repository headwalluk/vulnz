# Production Deployment

This guide covers deploying VULNZ to a production server.

## Requirements

- **MySQL/MariaDB**: Any recent version should be fine.
- **Node.js**: v22+ recommended. Tested with Node v22.21.0
- **Linux/BSD server**: This is a server-based application designed for website hosting providers.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/headwalluk/vulnz
   cd vulnz
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure your environment:**
   - Copy `env.sample` to `.env`:
     ```bash
     cp env.sample .env
     ```
   - Edit the `.env` file and set up your MySQL/MariaDB database credentials, SMTP settings, etc.
   - **Generate a secure SESSION_SECRET:**
     ```bash
     bash scripts/generate-session-secret.sh
     ```
     This automatically creates a cryptographically secure 48-character random string and saves it to your `.env` file.
   - Ensure `NODE_ENV` is not set or set to `production` in your environment.

## Build Production Assets

Before running in production, build the optimized assets:

```bash
npm run build
```

This creates the `dist/` directory with bundled/minified CSS/JS and transformed HTML.

## Initial Setup (Setup Mode)

1. In your `.env` file, set `SETUP_MODE=true`.
2. Start the application:
   ```bash
   npm run start
   ```
3. Open your browser and navigate to the application.
4. Register a new user account. This first account will automatically be granted administrator privileges.

## Secure Production Mode

**IMPORTANT:** After creating your administrator account, stop the application and:

1. Change `SETUP_MODE` to `false` in your `.env` file. This prevents subsequent registrations from receiving admin privileges.
2. Optionally set `REGISTRATION_ENABLED=false` to disable public sign-ups entirely.

## Start the Application

```bash
npm run start
```

The production server will:

- Serve static assets from `dist/`
- Exit with an error if build artifacts are missing
- Run on the port specified by `HTTP_LISTEN_PORT` (default: 3000)

## Running with PM2 (Recommended)

For production environments, use PM2 to run the application in cluster mode with automatic restarts.

Example flow using the provided sample ecosystem file:

```bash
# Copy the sample configuration file
cp ecosystem-sample.config.js ecosystem.config.js

# Start in production (edit ecosystem as needed)
pm2 start ecosystem.config.js --env production

# Or run in development
pm2 start ecosystem.config.js --env development
```

### PM2 Tips

- Edit `ecosystem.config.js` to adjust the number of instances, memory limits, etc.
- Use `pm2 logs` to view application logs
- Use `pm2 restart vulnz` after configuration changes
- Use `pm2 save` and `pm2 startup` to ensure PM2 starts on system boot

## Reverse Proxy (Apache/Nginx)

If your VULNZ installation should be publicly accessible, host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

Update `BASE_URL` in your `.env` to match your public-facing URL.

Ensure your reverse proxy is configured to forward the client IP address so rate limiting works correctly (set `trust proxy` in Express if needed).

## CORS Configuration

If you're building a browser-based client (e.g., WordPress plugin, SPA) that needs to make API calls to VULNZ from a different domain, enable CORS:

```bash
# Enable CORS
CORS_ENABLED=true

# Allow specific origins (recommended for production)
CORS_ORIGIN=https://example.com,https://app.example.com

# Or allow all origins (NOT recommended for production)
# CORS_ORIGIN=*

# Enable credentials (cookies, authorization headers)
CORS_CREDENTIALS=true
```

**Security Notes:**

- Always use specific origins in production (comma-separated list)
- Only use `CORS_ORIGIN=*` for development or public APIs
- Enable `CORS_CREDENTIALS=true` if your client needs to send cookies or authorization headers
- The API already uses API key authentication via `X-API-Key` header, which works with CORS

**Example for WordPress Plugin:**

```bash
CORS_ENABLED=true
CORS_ORIGIN=https://yourwordpresssite.com
CORS_CREDENTIALS=true
```

## Rate Limiting for Unauthenticated Requests

The app applies a simple per-second cap on unauthenticated search requests. Configure this with the `UNAUTH_SEARCH_LIMIT_PER_SECOND` environment variable:

- Default: `1` (safer default for new deployments)
- Disable entirely: set to `0`
- Any positive integer: maximum unauthenticated requests per second from a single IP

Examples in your `.env`:

```
# Allow 5 unauthenticated searches per second per IP
UNAUTH_SEARCH_LIMIT_PER_SECOND=5

# Disable unauthenticated rate limiting entirely (not generally recommended)
UNAUTH_SEARCH_LIMIT_PER_SECOND=0
```

Notes:

- Authenticated users are not affected by this limiter and have separate handling.
- If you run behind a reverse proxy, ensure the app sees the client IP (e.g., configure `trust proxy`).
- This is particularly important for production deployments to prevent abuse of public-facing instances.

## Automatic Stale Website Deletion

VULNZ can automatically delete websites that haven't been updated in a configurable number of days. This feature helps maintain a clean database when clients decommission infrastructure or stop using VULNZ.

### How It Works

- The `websites.updated_at` timestamp is automatically updated by MySQL whenever website properties change
- When components (plugins/themes) are added, removed, or modified, VULNZ explicitly updates the `updated_at` timestamp
- A daily cron job checks for websites older than the configured threshold and deletes them
- Deleted websites will be automatically re-added if they're still active and managed via API

### Configuration

Add these environment variables to your `.env` file:

```bash
# Enable/disable automatic deletion (default: false for safety)
WEBSITE_AUTO_DELETE_ENABLED=false

# Number of days before a website is considered stale (default: 30)
WEBSITE_AUTO_DELETE_DAYS=30
```

### Important Safety Notes

1. **Start with monitoring disabled**: Leave `WEBSITE_AUTO_DELETE_ENABLED=false` initially
2. **Monitor timestamps**: Watch the `websites.updated_at` column for several days to ensure it updates correctly when:
   - Website properties change (title, meta, is_dev, etc.)
   - Components are added/removed/changed via API
3. **Enable carefully**: Only set `WEBSITE_AUTO_DELETE_ENABLED=true` after confirming the behavior
4. **No user notification**: Users are NOT notified when websites are auto-deleted
5. **API safety**: If clients manage websites via API, deleted websites will be re-added automatically on the next sync

### Monitoring

Check the application logs for deletion activity:

```bash
# With PM2
pm2 logs vulnz | grep "stale website"

# Direct logs
grep "stale website" /path/to/logs
```

The cron job runs daily at midnight and logs:

- When it starts: `Running cron job to delete stale websites (older than N days)...`
- How many deleted: `Deleted N stale website(s).`
- Any errors encountered

### Recommendation

For most deployments:

- Keep `WEBSITE_AUTO_DELETE_DAYS=30` (or longer, like 60-90 days)
- Monitor for at least 1-2 weeks before enabling
- Review deletion logs regularly after enabling
