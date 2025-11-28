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
