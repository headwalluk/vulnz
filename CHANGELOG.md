# Changelog

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

- Fixed the saerch results by removing duplicates and apply a less aggressive sanitsation of the search query.
- Added linting and formatting (prettier) and tidied up the code a bit.

## 0.9.0- 2025-10-19

- Break the admin dashboard into multiple endpoints.
- Don't run the internal cron housekeeping tasks on pm2 cluster mode, unless we're the primary instance.
- Updated the API call logging, with call-log retention housekeeping.
- Minor cosmetic adjustments.
- Updated swagger docs.
