# VULNZ

Self-hosted vulnerability database for WP plugins and themes. The database is primarily accessed through an API, and there is a UI for basic admin tasks.

The application pulls from wordpress.org for plugin & theme metadata. We don't store details about each vulnerability - only link(s) to the original disclosure URL(s).

This can best be thought of as a vulnerability metabase.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

## Who is this for?

The app is designed to help WordPress hosting providers collate and manage WP plugin vulnerabilities across their clients' sites. If you want your VULNZ installation to be publicly accessible, you can host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

## Requirements

- MySQL/MariaDB: Any recent version should be fine.
- BASH: Required if you want to use the tools to backup, restore and pull from wordfence.com.
- Node: v22+ recommended. Tested with Node v22.21.0

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

## Populating the Database

The database will be empty initially. You will need to use the API to add websites, components, and vulnerabilities.

We will be adding scripts and tools to pull from several public vulnerability databases soon. We will also release a WordPress plugin in the near future, which will link to the app via the API to automate website and component tracking.

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
