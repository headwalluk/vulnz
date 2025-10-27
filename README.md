# VULNZ

Self-hosted vulnerability database for WP plugins and themes. The database is primarily accessed through an API, and there is a UI for basic admin tasks.

The application pulls from wordpress.org for plugin & theme metadata. We don't store details about each vulnerability - only link(s) to the original disclosure URL(s).

This can best be thought of as a vulnerability metabase.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

## Who is this for?

The app is designed to help WordPress hosting providers collate and manage WP plugin vulnerabilities across their clients' sites. If you want your VULNZ installation to be publicly accessible, you can host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

![List of websites](assets/v1.3.0/vulnz-dashboard-your-websites.png 'Websites managed in VULNZ')

![Reporting and API Keys](assets/v1.3.0/vulnz-reporting-and-api-keys.png 'Reporting and API Key management')

## Requirements

- Node: v22+ recommended. Tested with Node v22.21.0
- MySQL/MariaDB: Any recent version should be fine.

## Self-Hosting

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/headwalluk/vulnz
    cd vulnz
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Configure your environment:**
    - Copy `env.sample` to `.env`:
      ```bash
      cp env.sample .env
      ```
    - Edit the `.env` file and set up your MySQL/MariaDB database credentials.

4.  **Scripts (dev vs prod):**
    - Development (serves `public/` with separate assets and automatic restarts):

      ```bash
      npm run dev
      ```

    - Build production artifacts (bundled/minified CSS/JS, validated/minified HTML into `dist/`):

      ```bash
      npm run build
      ```

      This generates:
      - `dist/build/css/app.bundle.min.css`
      - `dist/build/js/core.bundle.min.js`
      - `dist/build/js/pages/*.bundle.min.js`
      - Transformed HTML files in `dist/` referencing the bundles
      - Copied static files like `partials/` and `favicon.png`

      The server auto-selects `public` in development and `dist` in production based on `NODE_ENV`.

    - Start in production (requires a prior build; will exit with a helpful error if `dist` is missing):

      ```bash
      npm run start
      ```

    - Clean the build output:
      ```bash
      npm run clean
      ```

5.  **Initial Setup (Setup Mode):**
    - In your `.env` file, set `SETUP_MODE=true`.
    - Start the application:
      ```bash
      npm run start
      ```
    - Open your browser and navigate to the application (e.g., `http://localhost:3000`).
    - Register a new user account. This first account will automatically be granted administrator privileges.

6.  **Switch to Production Mode:**
    - **IMPORTANT:** After creating your administrator account, stop the application and change `SETUP_MODE` to `false` in your `.env` file. This is a critical security step to ensure that subsequent user registrations do not receive administrator privileges.
    - You can also choose to disable new user registrations entirely by setting `REGISTRATION_ENABLED=false`.

7.  **Restart the application:**

    ```bash
    npm run start
    ```

8.  **Running with PM2 (Optional):**

    Example flow using the provided sample ecosystem file:

    ```bash
    # Copy the sample configuration file
    cp ecosystem-sample.config.js ecosystem.config.js
    
    # Start in production (edit ecosystem as needed)
    pm2 start ecosystem.config.js --env production
    
    # Or run in development
    pm2 start ecosystem.config.js --env development
    ```

## Rate limiting for unauthenticated requests

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

## Importing Wordfence vulnerabilities (optional)

You can pull the public Wordfence Intelligence feed and insert vulnerabilities into VULNZ in small batches using the helper script at `scripts/process-wordfence-feed.sh`. It’s suitable for running periodically via cron on Linux/BSD servers.

Prerequisites:

- Bash (installed by default on most systems)
- jq
- wget
- HTTPie (provides the `http`/`https` CLI)

Setup:

1. Create a `.env.wordfence` file in the project root with at least the following:

```bash
# VULNZ API base (note the /api suffix)
VULNZ_API_URL=http://localhost:3000/api

# An API key with permissions to add component releases and vulnerabilities
VULNZ_API_KEY=YOUR_API_KEY_HERE

# Optional: a persistent working directory for cache/state
# (recommended: avoids re-downloading and preserves processed IDs)
WORK_DIR=/var/local/vulnz

# Optional: set to 'true' to print extra diagnostics when the script runs
ENABLE_DIAGNOSTICS=false

# Optional: number of Wordfence entries to process per run (default 20)
BATCH_SIZE=20
```

2. Run the script manually to test:

```bash
bash scripts/process-wordfence-feed.sh
```

What it does:

- Downloads the Wordfence production feed JSON and caches it under `WORK_DIR` (re-fetched daily).
- Maintains a simple state file of processed Wordfence IDs (cleared weekly) to avoid re-processing.
- For each feed entry, processes affected plugin versions and adds vulnerability URLs to matching releases in VULNZ via the API.
- Batches work in small chunks per run (default batch size is 20; override by setting `BATCH_SIZE` in `.env.wordfence`).

Cron scheduling example (run every hour):

```bash
0 * * * * /usr/bin/env bash /path/to/vulnz/scripts/process-wordfence-feed.sh > /dev/null 2>&1
```

Notes:

- The script currently focuses on WordPress plugins. Theme entries in the feed are skipped.
- Ensure your `VULNZ_API_URL` matches your deployment (e.g., behind a reverse proxy, use the internal API base).
- If your instance enforces rate limits, keep the default batch size or schedule less frequently.

## Populating the Database

The database will be empty initially. You will need to use the API to add websites, components, and vulnerabilities.

We will be adding scripts and tools to pull from several public vulnerability databases soon.

## WordPress Plugin

We have a WordPress plugin that you can install on your sites to link back to your VULNZ API. You can download a ready-to-go version of the plugin from its Github page, here: https://github.com/headwalluk/wp-vulnz

Download the zip file from the dist/plugins directory, install it on your WordPress site(s) and configure the API key. It will automatically sync with your VULNZ back-end so it can track your plugins and their versions.

## API Usage

If you're running vulnz on a localhost on port 3000 (the defaults), all the API Docs are available via Swagger:

`http://localhost:3000/doc`

The following examples use [HTTPie](https://httpie.io/) but will work just as well with cURL.

### Example: Adding a vulnerability report to a plugin

```bash
# The vulnerability information we want to add.
BODY='{"urls": [ "https://a-security-website/news/security-hole-found-in-woo-1-2-3/" ] }'

# POST to our locally hosted VULNZ API. The plugin & release will be added to
# the database automatically if they're not already in there.
echo "${BODY}" | http POST http://localhost:3000/api/components/wordpress-plugin/woocommerce/1.2.3 \
  "X-API-Key: YOUR_API_KEY"
```

### Example: Adding a new website

```bash
# Our website's metadata.
BODY='{"domain": "my-clients-website.com"}'

# POST to our locally hosted VULNZ API.
echo "${BODY}" | http POST http://localhost:3000/api/websites \
  "X-API-Key: YOUR_API_KEY"
```
