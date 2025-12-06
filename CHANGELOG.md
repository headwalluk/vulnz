# Changelog

## 1.10.0 2025-12-06

### Features
- **Security Events Logging**: Track security-relevant events from monitored websites
  - New `security_event_types` and `security_events` tables with 10 pre-seeded event types
  - Geographic context via MaxMind GeoIP integration (continent/country codes)
  - `POST /api/websites/:domain/security-events` endpoint for bulk event recording
  - Automatic purge cron job with configurable retention (default: 30 days)
  - Event types: failed-login, brute-force, SQL injection, XSS, user enumeration, plugin/theme enumeration, etc.

- **Version Tracking**: Monitor software versions across all websites
  - Added WordPress, PHP, and database server version fields to websites table
  - `PUT /api/websites/:domain/versions` endpoint to update version information
  - Query methods for finding outdated WordPress and PHP installations
  - Version comparison using SQL string comparison
  - Configurable minimum/recommended versions via environment variables

- **Static Analysis Integration**: Store PHP security scan results
  - New `file_security_issues` table with touch-based purging strategy
  - `POST /api/websites/:domain/security-scan` endpoint for phpcs/security scanner results
  - Severity levels: error, warning, info
  - Sample scanner script (`scripts/scan-website.sh`) demonstrating PHP_CodeSniffer integration
  - Issues not seen in recent scans are automatically purged (default: 30 days)

- **Component Changes Tracking**: Comprehensive audit trail for plugins/themes
  - New `component_changes` table tracking additions, removals, and updates
  - Automatic change detection when website components are modified via API
  - Records old/new release versions, change type, user, and source (api/ui/sync/plugin)
  - Long-term retention for audit purposes (default: 365 days)
  - Weekly purge cron job for old changes

- **Enhanced Weekly Reports**: Dramatically improved security reporting
  - Security events summary with attack source countries (past 7 days)
  - Outdated software detection (WordPress/PHP versions below minimum)
  - Static analysis issues grouped by website with severity counts
  - Component changes with detailed version information and timestamps
  - All sections properly filtered by user ownership for non-admin users
  - Improved email template with structured, actionable information

### Bug Fixes
- Fixed SQL syntax errors in bulk insert operations (security events, component changes)
- Changed SQL alias from 'set' to 'evt' to avoid reserved keyword conflict
- Fixed user filtering in fileSecurityIssue and componentChange queries
- Added proper userId parameter support to findOutdatedWordPress/Php functions
- Fixed component change tracking to use proper component_id and release_id
- Removed debug logging from component change tracking

### Infrastructure
- Added 4 new database migrations for v1.10.0 features
- Added 3 new cron jobs (security events purge, file issues purge, component changes purge)
- New environment variables: GEOIP_DATABASE_PATH, SECURITY_EVENTS_RETENTION_DAYS, FILE_SECURITY_ISSUES_RETENTION_DAYS, COMPONENT_CHANGES_RETENTION_DAYS, WORDPRESS_STABLE_VERSION, PHP_MINIMUM_VERSION, etc.
- Created comprehensive documentation for all new features

### Documentation
- Added docs/security-events.md - Security events logging guide
- Added docs/version-tracking.md - Version monitoring documentation
- Added docs/static-analysis.md - Static analysis integration guide
- Added docs/component-changes.md - Component change tracking documentation
- Added docs/enhanced-reporting.md - Enhanced reporting overview

## 1.9.0 2025-12-05

### Features
- **Automatic Stale Website Deletion**: New cron job to automatically remove inactive websites
  - Added `Website.touch(websiteId)` method to update `updated_at` timestamp when components change
  - Added `Website.removeStaleWebsites(days)` method to delete websites older than threshold
  - Daily cron job runs at midnight to remove stale websites (disabled by default)
  - New environment variables: `WEBSITE_AUTO_DELETE_ENABLED` (default: false), `WEBSITE_AUTO_DELETE_DAYS` (default: 30)
  - `updated_at` timestamp now updates when website components (plugins/themes) are modified
  - Comprehensive documentation added to deployment guide with safety notes and monitoring instructions
  - Designed for API-managed deployments where deleted websites are automatically re-added if still active

## 1.8.1 2025-12-04

### Bug Fixes
- Fixed Edit and Delete buttons not working on filtered search results in admin components page
  - Updated event handlers to use `.attr('data-id')` instead of `.data('id')` for dynamically injected HTML
  - Added `id` field to component search API response to match list endpoint structure
- Auto-cancel component editing when searching or paginating to prevent stale edit state

## 1.8.0 2025-12-04

### Features
- Added search functionality to admin components page (`/admin/components`)
  - Search box with Bootstrap styling matching users page design
  - Real-time search filtering using existing `/api/components/search` endpoint
  - Pagination preserved during search
  - Empty state messages for no results
  - Search state maintained across pagination and reload

## 1.7.1 2025-12-04

### Security
- Updated `validator` dependency override from 13.15.20 to 13.15.23 to address high severity vulnerability (GHSA-vghf-hv5q-vc2g)
- npm audit now reports 0 vulnerabilities

## 1.7.0 2025-11-28

### Documentation
- **Major restructure:** Split comprehensive README.md into organized docs/ directory
  - Created `docs/development.md` - Local development setup guide
  - Created `docs/deployment.md` - Production deployment guide
  - Created `docs/reverse-proxy.md` - Apache/Nginx configuration with SSL/TLS
  - Created `docs/wordfence-importer.md` - Wordfence feed import documentation
  - Created `docs/api-usage.md` - REST API examples and Swagger reference
  - Created `docs/wordpress-plugin.md` - WordPress plugin integration info
  - Created `docs/roadmap.md` - Planned features and security enhancements
- Transformed README.md into concise landing page with badges and quick start
- Added badges for Node.js version, MIT license, database requirements, and security features
- Rate limiting documentation moved from development to deployment guide

### Security
- **New:** Startup check for .env file permissions (must be 0600)
  - Prevents accidental world-readable secrets
  - Clear error messaging with fix instructions
  - Can be bypassed with `SKIP_STARTUP_FILEMODE_CHECKS=true` if needed
- **New:** `scripts/generate-session-secret.sh` - Automated SESSION_SECRET generation
  - Generates cryptographically secure 48-character random strings
  - Automatically detects and updates placeholder values
  - Prevents accidental overwrites of existing secrets
  - Cross-platform support (Linux/macOS)
- Enhanced SESSION_SECRET documentation in env.sample with generation instructions
- Security analysis documented in roadmap with prioritized improvements

### License
- Changed from ISC to MIT license
- Updated copyright to Paul Faulkner

## 1.6.2 2025-11-03

- Fixed the report-email logs not being purged correctly at regular intervals. Default to 14 days.
- Updated npm dependencies.

## 1.6.1 2025-11-03

- Updated node dependencies. No issues with the audit.

## 1.6.0 2025-11-03

- Fixed a typo in the weekly report email.
- Added a "success" message to the report email when the number of vulnerable websites is zero.

## 1.5.0 2025-10-27

- New: Wordfence feed import script
  - Added `scripts/process-wordfence-feed.sh` to download the public Wordfence Intelligence feed and insert vulnerabilities into VULNZ in batches.
  - Configurable via a project-root `.env.wordfence` file (see `env.wordfence.sample`).
  - Supports `BATCH_SIZE` to limit items processed per run (default 20) and a persistent `WORK_DIR` for caching/state.
  - Suitable for cron; see README for prerequisites, setup, and a scheduling example.
- Docs: README section describing setup, usage, and cron for the Wordfence importer.

## 1.4.1 2025-10-27

- Tweaked the styling on the login, register & reset-password pages for better vertical alignment.
- Updated the html-validate package 10 10.x.x.
- When syncing a pkugin with wordpress.org, use the wordpress.org plugin page as canonical, rather than the plugin author's specified homepage.

## 1.4.0 2025-10-26

- Improved image assets and image caching to give better page-speed experience.

## 1.3.1 2025-10-26

- Docs: Add swagger documentation for website routes.

## 1.3.0 2025-10-26

- Feature: Add `Cache-Control` headers for static assets in production.
- Fix: Theme switcher visibility and functionality.
- Fix: Responsive layout issues on dashboard and admin pages.

## 1.2.0 2025-10-26

- Build and deployment
  - Added an optimized build pipeline that bundles and minifies CSS/JS, rewrites HTML to reference bundles, validates HTML, and minifies HTML output. Artifacts are written to `dist/`.
  - Server now serves `public/` in development and `dist/` in production, selected via `NODE_ENV`.
  - Added startup guard in production to ensure required build artifacts exist before booting.
  - New scripts: `npm run dev` (development with nodemon), `npm run build` (produce `dist/`), `npm run start` (production).
- UI/Theme
  - Refined dark/light theme handling on the front page; the Search button now adapts to the active Bootstrap theme.
- HTML quality
  - Fixed malformed HTML in `public/dashboard.html` where the body content was inside the `<head>` tag.
  - Integrated HTML validation and minification into the build.
- Middleware
  - Updated `redirectHtml` to special-case `index.html` (e.g., `/index.html` → `/`, `/admin/index.html` → `/admin`) and preserve query strings.
- Configuration
  - Centralized environment normalization (e.g., `SETUP_MODE`, `REGISTRATION_ENABLED`, `CRON_ENABLE`, `NODE_APP_INSTANCE`, `UNAUTH_SEARCH_LIMIT_PER_SECOND`).
  - Added unauthenticated search rate-limiting with configurable per-second caps; `UNAUTH_SEARCH_LIMIT_PER_SECOND=0` disables.
- Security/Dependencies
  - Resolved npm audit moderates by updating `validator` to a patched version via overrides.

## 1.1.1 2025-10-25

- Added light/dark mode support to login, register, and password-reset pages.
- Fixed alignment and loading spinner issues on auth pages.

## 1.1.0 2025-10-25

- Added light/dark mode with automatic theme detection.

## 1.0.0 2025-10-25

- First stable release.

## 0.50.0 2025-10-25

- **Security Fix:** Implemented a middleware to prevent unauthenticated access to `.html` pages, resolving a critical security loophole.
- **Dashboard UI Enhancements:**
  - Vulnerable components are now sorted to the top of the list in the website info modal.
  - The modal now displays website `meta` data instead of the owner's email, with special formatting for links and email addresses.
  - Various styling improvements, such as removing bold from component slugs and adding icons to links.
- **API Improvements:**
  - The `/api/websites` endpoints now return an empty object `{}` for the `meta` field when it is `null`.
- **Code Quality:**
  - Fixed a linting error in `public/js/dashboard.js`.

## 0.45.0 2025-10-25

- Fixed the report emails so administrators get ALL sites, whereas each user only gets their own sites.
- Added a JSON meta property to the website model, so we can POST/PUT custom website meta data as key/value pairs (e.g. Login URL, host server, whatever).

## 0.38.0 2025-10-24

- Added support for dev/staging sites.
- Added support for user account alternative email address for reporting.
- Weekly summary email cron is in there now (1st version).

## 0.33.0 2025-10-23

- Cleaner data input/out when POSTing to the /api/users route to create new users (using an administrator's API key in the request header).
- Tidying up the list of websites in the /dahboard page.
- Tidying up the modal plugin list when clicking a website's "info..." button.
- Made the paging toolbars for result-sets more consistent across the back-end UI.
- Tweaking the domainRegex when validitaing domains of newly created website records.
- Removed some tooltips that were just cluttering the UI.

## 0.15.0 2025-10-21

- Support for multiple users monitoring their own websites independent of each other.
- The /api/websites REST endpoint is coming together now, with an addition to the /dashboard page su users can track the websites' vulnerabilities.

## 0.12.0 2025-10-20

- Fixed the search results by removing duplicates and apply a less aggressive sanitsation of the search query.
- Added linting and formatting (prettier) and tidied up the code a bit.

## 0.9.0- 2025-10-19

- Break the admin dashboard into multiple endpoints.
- Don't run the internal cron housekeeping tasks on pm2 cluster mode, unless we're the primary instance.
- Updated the API call logging, with call-log retention housekeeping.
- Minor cosmetic adjustments.
- Updated swagger docs.
