# Changelog

## 1.22.2 - 2026-02-23

### Bug Fixes

- **Helmet CSP**: Disabled `upgrade-insecure-requests` directive in non-production environments so assets load correctly over HTTP when using a custom `BASE_URL` (e.g. LAN hostname)

---

## 1.22.1 - 2026-02-22

### Bug Fixes

- **Multi-ecosystem migration**: Fixed `20260217000000-add-multi-ecosystem-support.js` failing on clean installs
  - `ALTER TABLE component_types ADD COLUMN ecosystem_id ... AFTER id` referenced non-existent `id` column — changed to `AFTER slug` (the actual primary key)
  - `INSERT INTO component_types` used `name` column — changed to `title` (the actual column name)

---

## 1.22.0 - 2026-02-17

### CLI Administration Tool

- **New CLI tool** (`bin/vulnz.js`) for managing users, API keys, and inspecting the database from the command line — no web interface required.
  - Reads `.env` automatically; designed for initial setup, scripted provisioning, and recovery scenarios.
  - If installed globally via npm, invoke as `vulnz <command>`.
  - Outputs formatted tables by default; supports `--json` flag on all listing commands.
  - Exits with code `1` on error (stderr), `0` on success (stdout).
  - Replaces the `SETUP_MODE` auto-admin approach (removed).

- **User management commands:**
  - `user:add <email> <password> [--admin]` — create a user; `--admin` grants the administrator role
  - `user:list [--json]` — list all accounts with id, email, roles, and status
  - `user:delete <email>` — permanently delete a user
  - `user:block <email>` / `user:unblock <email>` — block/unblock account access
  - `user:reset-password <email> <new-password>` — reset a user's password

- **API key management commands:**
  - `key:list <email> [--json]` — list all API keys for a user
  - `key:generate <email>` — generate a new API key (key printed once to stdout)
  - `key:revoke <key>` — permanently revoke an API key

- **Diagnostic commands:**
  - `feed:status [--json]` — show database statistics and last Wordfence sync timestamp
  - `component:find <slug> [--json]` — look up a component by slug (returns all type matches)
  - `release:list <slug> [--json]` — list all known releases for a component with per-release vulnerability counts

- **Tests:** CLI commands fully covered by Jest test suite (all 184 tests passing).

### npm Ecosystem Support

- **Multi-ecosystem architecture**: Vulnz now tracks vulnerabilities across multiple component ecosystems, not just WordPress.
  - New `ecosystems` database table with JSON configuration per ecosystem
  - WordPress and npm ecosystems seeded out of the box (PyPI included for future use)
  - Websites can now specify an ecosystem (default: backwards-compatible WordPress behaviour)
  - `component_types` linked to ecosystems via `ecosystem_id` foreign key
  - `websites` table gains `ecosystem_id` and `platform_metadata` (JSON) columns

- **New endpoint: `GET /api/ecosystems`** (authenticated)
  - Returns all active ecosystems (`id`, `slug`, `name`, `description`, `active`)
  - Useful for discovery and dynamic UI generation

- **Updated endpoint: `PUT /api/websites/:domain`**
  - Now accepts a generic `components` array (each item: `slug`, `version`, `type`)
  - Supports `npm-package` component type alongside existing WordPress types
  - Accepts `ecosystem` (string slug, e.g. `"npm"`) and `platform` (object, e.g. `{ "name": "Node.js", "version": "20.11.0" }`)
  - Fully backward-compatible: `wordpress-plugins` and `wordpress-themes` keys still work unchanged
  - See [API Usage](docs/api-usage.md) for examples

- **npm vulnerability feed processor**: `scripts/process-npm-vulnerabilities.sh`
  - Reads tracked npm packages from the VULNZ API
  - Batch-queries [OSV.dev](https://osv.dev) (Google's Open Source Vulnerability database) for CVEs
  - Inserts/updates vulnerability records for affected releases
  - Designed for daily cron execution
  - Configuration via `.env.npm-vulnerabilities` (separate from main `.env`)

- **`vulnz-sensor` npm package** (`packages/vulnz-sensor/`)
  - Lightweight CLI tool for Node.js projects — zero runtime dependencies
  - Reads `package.json` and resolves exact installed versions from `node_modules`
  - Reports dependencies to VULNZ via `PUT /api/websites/:domain`
  - Supports `--dry-run`, `--include-dev`, `--dir`, and env-var configuration
  - Designed for CI/CD pipelines (GitHub Actions example in its README)
  - Can also be used as a `postinstall` script or programmatic library
  - See [`packages/vulnz-sensor/README.md`](packages/vulnz-sensor/README.md) for full usage

- **Tests**: 184 tests passing (194 total — 10 pre-existing skips for production-only behaviour)
  - New test suite covering `GET /api/ecosystems`, npm-package components in `PUT /api/websites`, and WordPress backward-compatibility

### Database Migrations

- `20260117000000-add-ecosystems-table.js` — creates `ecosystems` table and seeds wordpress/npm/pypi
- `20260117000001-add-ecosystem-to-component-types.js` — adds `ecosystem_id` FK to `component_types`, updates existing types to WordPress ecosystem, seeds `npm-package` type
- `20260117000002-add-ecosystem-to-websites.js` — adds `ecosystem_id` and `platform_metadata` to `websites`, migrates existing websites to WordPress ecosystem

---

## 1.21.5 - 2026-02-06

### Bug Fixes

- **Wordfence Feed Processing**: Fixed bash arithmetic errors in version comparison
  - Added newline and carriage return sanitization to version string extraction
  - Prevents `10#` base conversion errors when version strings contain whitespace
  - Resolves syntax errors in `scripts/process-wordfence-feed.sh` cron job

## 1.21.4 - 2026-01-27

### Maintenance

- **Dependencies**: Updated all npm dependencies to latest versions
  - Ran `npm update` and `npm audit fix` to ensure all packages are current
  - Production dependencies: 0 vulnerabilities (all clean)
  - Dev dependencies: Updated sqlite3 to 5.1.7 (remaining tar vulnerabilities are dev-only and do not affect production)
- **Reference Data**: Updated WordPress minimum version to 6.8 in reference.json

## 1.21.3 - 2026-01-13

### Bug Fixes

- **User Creation**: Fixed `enable_white_label` null constraint violation
  - Simplified boolean normalization logic in `createUser()` function
  - Now uses explicit boolean conversion (`enable_white_label ? true : false`)
  - Ensures `null` and `undefined` values are always converted to `false` before database insertion
  - Resolves "Column 'enable_white_label' cannot be null" error when creating users via API

## 1.21.2 - 2026-01-02

### Testing Infrastructure

- **Complete Test Suite Overhaul**: Achieved 114/114 passing tests (10 intentionally skipped)
  - Fixed authentication in all test suites to use production Passport configuration
  - Corrected database schema mismatches between tests and production
  - Added boolean→integer conversion for SQLite compatibility
  - Fixed null handling for `enable_white_label` field in user creation
  - Added SQLITE_CONSTRAINT error code handling alongside MySQL ER_DUP_ENTRY
  - Updated test expectations to match production API responses (plain text vs JSON)
- **Test Suite Coverage**:
  - Auth API: 22/22 passing (2 skipped - rate limiting tests)
  - Components API: 30/30 passing (4 skipped - production behavior differences)
  - Settings API: 21/21 passing
  - Users API: 29/29 passing (4 skipped - production behavior differences)
  - Websites API: 12/12 passing

- **Test Infrastructure Improvements**:
  - Standardized API key authentication (plaintext, not hashed) across all test suites
  - Fixed user schema (username IS email, no separate email column)
  - Corrected column names (blocked/paused instead of is_blocked/reporting_paused)
  - Fixed component schema (title not name, component_type_slug not component_type_id)
  - Converted MySQL SQL to SQLite (INSERT IGNORE → INSERT OR IGNORE, ON DUPLICATE KEY UPDATE)
  - All tests now use authentic production behavior

### Bug Fixes

- **User Model**: Fixed null handling in `createUser()` function
  - Now properly handles `null` values for `enable_white_label`, `blocked`, and `paused` parameters
  - Prevents NOT NULL constraint violations when creating users via API

- **Error Handling**: Added SQLite error code support in user creation endpoint
  - Duplicate username errors now properly return 409 status in both MySQL and SQLite environments

## 1.21.1 - 2025-12-31

### Documentation

- **API Documentation**: Added missing Swagger/OpenAPI documentation for `PUT /api/users/me`
  - Now properly documents all supported properties: `reporting_weekday`, `reporting_email`, `enable_white_label`, `white_label_html`
  - Added character limit constraint (`maxLength: 16384`) for `white_label_html` in API schema
  - Clarified that `is_dev` is a website property, not a user property

### Maintenance

- Updated npm dependencies via `npm audit` and `npm update`

## 1.21.0 - 2025-12-31

### Account Status Management

- **Pause/Unpause Accounts**: Users can now temporarily pause their own accounts, and admins can pause other accounts
  - Paused users cannot log in via web UI but retain API key access (to unpause themselves)
  - Paused users are excluded from scheduled vulnerability reports
  - Self-service temporary suspension for users going on vacation, during migrations, etc.

- **Block/Unblock Accounts**: Administrators can now block user accounts for security violations
  - Blocked users have complete lockout - no UI login, no API key access
  - Admins cannot block their own account (prevents system lockout)
  - Admin-imposed hard lockout for policy enforcement

- **Database Changes**:
  - Added `paused` (BOOLEAN) to users table with index
  - Migration: `20251231120000-add-paused-to-users.js`

- **API Updates**:
  - New endpoints:
    - `PUT /api/users/me/pause` - Pause own account
    - `PUT /api/users/me/unpause` - Unpause own account
    - `PUT /api/users/:id/pause` - Admin: pause user account
    - `PUT /api/users/:id/unpause` - Admin: unpause user account
    - `PUT /api/users/:id/block` - Admin: block user account (with self-block prevention)
    - `PUT /api/users/:id/unblock` - Admin: unblock user account
  - All user API responses now include `paused` field
  - User creation/update now accepts optional `paused` parameter (admin only)

- **Admin UI Enhancements**:
  - User list shows visual indicators for paused (warning icon) and blocked (danger icon) status
  - Added pause/unpause toggle buttons (outline warning style)
  - Added block/unblock toggle buttons (outline dark style)
  - Block button disabled for admin's own account
  - User edit form includes "Paused" toggle switch
  - Confirmation dialogs for block/unblock actions

- **Authentication Updates**:
  - Passport Local Strategy now rejects both blocked AND paused users from UI login
  - API key authentication allows paused users (enables self-unpause)
  - `/me/*` endpoints support both session and API key authentication

### API Route Consistency Improvements

- **Breaking Change**: Renamed password update endpoint for consistency
  - Old: `PUT /api/users/password`
  - New: `PUT /api/users/me/password`
  - All "current user" operations now follow `/api/users/me/*` pattern
  - Dashboard updated to use new endpoint

- **Consistent API Routes**:
  - `GET /api/users/me` - Get current user details
  - `PUT /api/users/me` - Update current user
  - `PUT /api/users/me/password` - Update password
  - `PUT /api/users/me/pause` - Pause own account
  - `PUT /api/users/me/unpause` - Unpause own account

### Documentation

- Added comprehensive documentation: `docs/account-status-management.md`
  - Requirements and security model
  - Permission matrix
  - Security considerations and risk mitigations
  - Implementation details
  - Database schema changes
  - Future enhancement suggestions

- Updated Swagger/OpenAPI documentation for all affected endpoints
  - Full request/response schemas
  - Admin-only restrictions documented
  - Error response codes

## 1.20.0 - 2025-12-21

### Bug Fixes

- **HTML Entity Decoding**: Fixed double-encoding issue in vulnerability reports
  - Component titles from WordPress.org API containing HTML entities (e.g., `&amp;`, `&gt;`, `&lt;`) were being double-encoded in email reports
  - Enhanced `stripAll()` function to decode HTML entities to plain text before storing in database
  - Added `decodeHtmlEntities()` helper function supporting both named and numeric entities
  - Migration `20251221130000-decode-html-entities-in-components.js` cleans existing data
  - Example: "Health Check &amp;amp; Troubleshooting" now correctly displays as "Health Check & Troubleshooting"

- **White-Label Dashboard Loading**: Fixed white-label settings not populating on page load
  - `/api/auth/me` now returns structured `whitelabel` object with `enabled` and `htmlSnippet` properties
  - Dashboard JavaScript properly checks for `whitelabel` object existence (backward compatible)
  - Checkbox and HTML snippet textarea now populate correctly from API response

## 1.19.0 - 2025-12-21

### White-Label Character Limit Increase

- **Expanded HTML Limit**: Increased white-label HTML character limit from 4096 to 16384 characters (16 KB)
  - Supports complex SVG logos and rich branding elements
  - Updated client-side validation in dashboard textarea
  - Updated server-side validation in API endpoints
  - Updated HTML sanitizer trim limit
  - Character counter now displays "X/16384"
  - Database TEXT column supports up to 65,535 bytes (no schema change needed)

## 1.18.0 - 2025-12-21

### White-Label Email Reports

- **Custom Branding**: Users can now white-label their weekly vulnerability reports
  - Enable/disable custom branding via checkbox in account settings
  - Replace default "vulnz" header with custom HTML (up to 16384 characters / 16 KB)
  - Inline SVG support recommended for logos (avoids spam risk from external images)
  - HTML sanitization prevents XSS while allowing email-safe tags and styles
  - Character counter shows remaining space (X/16384)
  - Collapsible example snippets in dashboard for quick reference
  - Test custom branding using existing "Send now" button

- **Database Changes**:
  - Added `enable_white_label` (BOOLEAN) to users table
  - Added `white_label_html` (TEXT) to users table
  - Migration: `20251221120000-add-white-label-to-users.js`

- **API Updates**:
  - `PUT /api/users/:id` and `PUT /api/users/me` accept white-label fields
  - Client-side and server-side validation for 16384 character limit (16 KB)
  - HTML sanitization using `sanitize-html` library
  - Appropriate error messages for validation failures

- **Email Template**:
  - Conditional rendering: custom HTML when enabled, default header otherwise
  - Graceful fallback if white-labeling enabled but HTML empty
  - Uses Handlebars triple-braces for unescaped HTML rendering

- **Security**:
  - Comprehensive HTML sanitization (removes scripts, event handlers, dangerous attributes)
  - Allows email-safe tags: table, tr, td, img, svg, h1-h6, p, span, div, a, etc.
  - Allows safe inline styles with regex validation
  - Allows inline SVG with path, circle, rect, text elements
  - External images allowed but users warned about spam risk

## 1.17.0 - 2025-12-20

### Email Report Redesign

- **Modern Email Template**: Complete redesign of weekly vulnerability reports
  - Professional, mobile-responsive design with card-based layout
  - Zero-click status banner (red for issues, green for all clear)
  - Dynamic subject line: "All Clear" or "Attention Required!"
  - Stats grid with at-a-glance metrics
  - Recommended actions section placed prominently for better UX
  - Color-coded sections: critical (red), warnings (amber), info (blue), success (green)
  - Removed unnecessary borders from last items in lists for cleaner appearance
  - Empty state messaging when no vulnerabilities found

- **Content Improvements**:
  - Added "All Monitored Websites" section
  - Added "Security Events (Past 7 Days)" with attack sources
  - Added "Outdated Core Software" details (WordPress & PHP)
  - Added "Static Analysis Issues" section
  - Added "Newly Published Plugins" watchlist
  - Softened "Abandoned Plugin Check" wording to be less aggressive
  - Maintained all data from previous template while improving readability

- **Email Client Compatibility**:
  - Proper MSO/Outlook conditional comments
  - Table-based layout for maximum compatibility
  - Inline styles throughout
  - Mobile-responsive with breakpoints
  - Tested across major email clients

## 1.16.0 - 2025-12-17

### API Improvements

- **CORS Support**: Added configurable CORS middleware for browser-based API clients
  - Configure via `.env` with `CORS_ENABLED`, `CORS_ORIGIN`, and `CORS_CREDENTIALS`
  - Support for single or multiple origins (comma-separated)
  - Allow all origins with `CORS_ORIGIN=*` (not recommended for production)
  - Enable/disable CORS entirely for flexible deployment scenarios
  - Graceful handling of disallowed origins (no server errors)
  - Documented in deployment guide with security best practices
  - Ready for WordPress plugin and SPA integrations

- **API Documentation**: Enhanced OpenAPI/Swagger documentation
  - Updated Swagger version to match project version (1.16.0)
  - Added ownership transfer documentation (`user_id` parameter in PUT /api/websites/{domain})
  - Improved Swagger UI with custom title and cleaner interface
  - OpenAPI JSON available at `/openapi.json` for external tool integration

## 1.15.0 - 2025-12-15

### Reporting Improvements

- **Email Report Streamlining**: Removed "Component Changes (Past 7 Days)" section
  - Reduces information overload in weekly security reports
  - Component change data still tracked and will be exposed via API in future
  - Cleaner, more focused email reports for clients

- **All Monitored Websites List**: Added comprehensive website listing
  - New section displays all monitored websites after vulnerable websites
  - Shows website title and domain in clean single-column format
  - Mobile-friendly layout without clickable links
  - Helps users verify all their websites are being monitored

## 1.14.1 - 2025-12-14

### UX Improvements

- **Website Info Modal**: Made modal wider using `modal-lg` class for better readability
- **Ownership Transfer UI**: Enhanced user experience
  - Fixed display state when reopening modal after clicking "Change"
  - Added auto-focus to search input when Select2 dropdown opens
  - Removed success alert (silent success, show only errors)
  - Restored modal focus after saving to enable immediate Escape key dismissal

## 1.14.0 - 2025-12-14

### Admin Features

- **Website Ownership Transfer**: Administrators can now change which user account owns a website
  - Searchable user dropdown using Select2 integration
  - Real-time AJAX user search via `/api/users?q=` endpoint
  - Enhanced website info modal on dashboard with ownership management
  - Server-side validation prevents NULL assignments and ensures target user exists
  - Admin-only authorization enforced on backend
  - Comprehensive test coverage (5 new tests)

### Infrastructure Improvements

- **Vendor Assets Management**: Migrated from CDN to local npm packages
  - Replaced Select2 CDN links with local vendor files
  - Added `select2` and `select2-bootstrap-5-theme` npm dependencies
  - Created `scripts/copy-vendor-deps.js` to manage vendor file deployment
  - Updated build script to include vendor directory in production builds
  - Automated vendor file copying via `postinstall` script

### Documentation

- **Future Development Roadmap**: Added `docs/future-development.md`
  - UI modernization recommendations (SPA migration strategies)
  - Feature roadmap with priorities and effort estimates
  - Technical debt tracking and improvement suggestions

## 1.13.0 - 2025-12-10

### Reporting Improvements

- **Executive Summary**: Added summary table at top of vulnerability reports
  - Quick overview of all monitored metrics (vulnerable websites, security events, outdated software, etc.)
  - Color-coded highlighting for items requiring attention
  - Provides at-a-glance security posture assessment

- **Recommended Actions**: Added prioritized action items section
  - Automatically generated based on report findings
  - Color-coded by priority (Critical: red, High: orange, Medium: brown, Low: black)
  - Actionable items with specific counts (e.g., "Update 5 websites with known vulnerabilities")
  - Appears only when there are actions to take

- **Plugin De-duplication**: Plugins now grouped across multiple websites
  - Unmaintained and newly published plugins shown once with website list
  - Reduces visual clutter when same plugin appears on multiple sites
  - Example: "Found on 5 websites: Site A, Site B, Site C, Site D, Site E"

- **Human-Readable Dates**: Improved date formatting throughout reports
  - Changed from "Sat Feb 08 2025 12:09:00 GMT..." to "Feb 8, 2025 (10 months ago)"
  - Applied to component changes, unmaintained plugins, and newly published plugins
  - Relative time indicators ("X months ago", "X days ago", "today")

- **Bug Fixes**:
  - Fixed BigInt type conversion in security events and static analysis totals
  - Added Handlebars helpers for conditional formatting (`eq`, `gt`)

### WordPress.org Metadata Integration

- **Metadata Capture**: Added 4 new fields to components table
  - `added` (DATE): When plugin was first published to wordpress.org
  - `last_updated` (DATETIME): Last update timestamp from wordpress.org
  - `requires_php` (VARCHAR): Minimum required PHP version
  - `tested` (VARCHAR): WordPress version tested up to

- **Date Parsing**: Created robust parsing functions for wordpress.org API formats
  - `parseWpOrgDateTime()`: Converts "2025-11-13 1:39pm GMT" to MySQL DATETIME
  - `parseWpOrgDate()`: Validates and stores YYYY-MM-DD format
  - Timezone-aware with UTC consistency throughout database

- **Plugins to Monitor**: New report section for maintenance awareness
  - ⚠️ Unmaintained Plugins: Not updated in 6+ months (configurable)
  - 🆕 Newly Published Plugins: Published within 3 months (configurable)
  - Helps identify potential security risks from abandoned or untested plugins

- **Periodic Re-sync**: Automatic metadata refresh system
  - `synced_from_wporg_at` timestamp tracks last sync per plugin
  - Daily cron job invalidates stale syncs (7+ days old by default)
  - Automatic re-sync triggered when components updated via API
  - Elegant priority queue: NULL-first sorting ensures never-synced plugins prioritized
  - Composite index for optimal query performance

### Configuration

- **New Environment Variables**:
  - `PLUGIN_UNMAINTAINED_THRESHOLD_MONTHS=6`: Months without update before flagging as unmaintained
  - `PLUGIN_NEWLY_PUBLISHED_THRESHOLD_MONTHS=3`: Age threshold for "newly published" warnings
  - `WPORG_RESYNC_DAYS=7`: Days before plugin metadata considered stale

### Infrastructure

- **Database Migrations**:
  - `20251210100000-add-wporg-metadata-to-components.js`: Adds wordpress.org metadata fields
  - `20251210110000-add-synced-from-wporg-at-to-components.js`: Adds sync timestamp and composite index

## 1.12.0 - 2025-12-07

### Reporting

- **Security Events Filtering**: Fixed weekly reports to only show security events from user's websites
  - Security events summary now filtered by user's website IDs
  - Top attack sources now filtered by user's website IDs
  - Consistent with existing filtering in Vulnerable Components, Outdated Software, Static Analysis, and Component Changes sections
  - Administrators continue to see all websites when generating reports

## 1.11.4 - 2025-12-06

### Code Quality

- **ESLint**: Fixed all 127 linting errors across the codebase
  - Configured Jest globals for test files (eslint.config.js)
  - Fixed missing middleware parameter (`next` in `canAccessWebsite`)
  - Removed unused variables and imports
  - Added inline disable for Express error handler signature
  - All tests passing (28/28)

## 1.11.3 - 2025-12-06

### Security Events

- **Deduplication**: Added database-level deduplication for security events
  - Unique constraint on `(website_id, event_type_id, source_ip, event_datetime)`
  - Second-level precision prevents duplicate events from same IP
  - `INSERT IGNORE` automatically skips duplicates in bulk operations
  - API returns `events_created` and `events_duplicate` counts
  - Supports single and bulk event submissions (tested up to 1,000 events)

### Reporting

- **Country Flags**: Added Unicode flag emojis to security event reports
  - Top Attack Sources now display country flags (e.g., 🇨🇳 CN, 🇩🇪 DE)
  - Regional Indicator Symbol conversion for all country codes
  - Graceful degradation in email clients without emoji support

### Infrastructure

- **Migration**: `20251206190000-add-security-events-dedup-constraint.js`
  - Adds unique key constraint for event deduplication
  - Idempotent migration (safe to re-run)

## 1.11.2 - 2025-12-06

### API Improvements

- **Consolidated Version Updates**: Enhanced `PUT /api/websites/:domain` endpoint
  - Now accepts optional `versions` object for updating WordPress, PHP, and database versions
  - Eliminates need for separate API call to `/api/websites/:domain/versions`
  - Supports partial updates (update only specified version fields)
  - Validates `db_server_type` (mysql|mariadb|unknown)
  - Maintains backward compatibility with existing integrations
  - Deprecated `PUT /api/websites/:domain/versions` endpoint (still functional)

### Testing

- **Websites API Tests**: Added 7 new tests for version update functionality
  - Tests version updates via consolidated endpoint
  - Tests validation and error handling
  - Tests partial updates and backward compatibility
  - All 28 tests passing (21 Settings + 7 Websites)

### Documentation

- **Swagger Documentation**: Updated API documentation
  - Added `versions` parameter to main PUT endpoint
  - Marked `/versions` endpoint as deprecated
  - Enhanced parameter descriptions and examples

### Infrastructure

- **Test Schema Updates**: Fixed test database schema
  - Updated websites table to match production (domain/title fields)
  - Added all version-related fields for comprehensive testing
  - Fixed `createTestWebsite()` helper to use correct schema

## 1.11.1 - 2025-12-06

### Testing Infrastructure

- **Comprehensive Test Suite**: Added automated testing with Jest and Supertest
  - 21/21 tests passing for Settings API endpoints
  - In-memory SQLite database for test isolation
  - Full authentication and authorization testing
  - Type casting validation tests
  - Admin-only endpoint protection verification
  - Created `tests/setup.js` with test utilities and MySQL→SQLite compatibility layer
  - Added `jest.config.js` with coverage thresholds (50% baseline)
  - Created comprehensive testing documentation in `tests/README.md`

- **Test Coverage**:
  - GET /api/settings - 5 tests (list, filter, group, auth)
  - GET /api/settings/:key - 3 tests (retrieve, 404, auth)
  - PUT /api/settings/:key - 5 tests (create, update, admin-only, validation)
  - DELETE /api/settings/:key - 5 tests (delete, protection, admin-only, 404)
  - Type Casting - 3 tests (integer, boolean, float)

### Documentation

- **Restructured README.md**: Streamlined from 333 to 156 lines
  - Moved project tracking to `docs/project-tracker.md`
  - Improved organization with clear sections for installation, configuration, and documentation links
  - Added tests badge showing current test status
  - Better focus on getting started vs diving deep

- **New Documentation**:
  - `tests/README.md` - Comprehensive testing guide with examples and best practices
  - `docs/project-tracker.md` - Centralized project tracking for all releases

### Dependencies

- Added dev dependencies:
  - `jest` - Test framework
  - `supertest` - HTTP API testing
  - `sqlite3` - In-memory test database
  - `bcryptjs` - Password hashing for tests

### Scripts

- Added `npm test` - Run all tests
- Added `npm run test:watch` - Watch mode for development
- Added `npm run test:coverage` - Generate coverage report

## 1.11.0 - 2025-12-06

### Features

- **App Settings System**: Database-backed configuration management
  - New `app_settings` table with typed key-value storage (string, integer, float, boolean)
  - REST API for settings management: GET/PUT/DELETE endpoints with admin-only write protection
  - 23 seeded default settings covering versions, retention periods, limits, and feature flags
  - System settings protection prevents accidental deletion of critical configuration
  - Automatic type casting on retrieval for type safety
  - Backward compatibility with environment variables via `getWithFallback()` method

- **Reference Data Updates**: Automated version threshold management
  - Automatic updates from trusted reference source (vulnz.net/reference.json)
  - Twice-daily cron job (11am/11pm GMT) aligned with WordPress release schedules
  - Semver validation for version strings
  - Graceful error handling with short timeouts (5 seconds)
  - Supports URL, local file, or disabled modes via configuration
  - Updates on server startup to ensure latest thresholds
  - Ignores unknown settings for backward compatibility with older VULNZ versions
  - Created `src/lib/referenceData.js` for centralized version management

- **Configuration Migration**: Moved settings from environment variables to database
  - WordPress version thresholds (current, minimum)
  - PHP version thresholds (minimum, recommended, EOL)
  - Database version minimums (MySQL, MariaDB)
  - Data retention periods (security events, file issues, component changes, email logs)
  - Batch processing sizes and rate limits
  - Feature flags (GeoIP, version tracking, component changes)
  - Report configuration options
  - All migrations maintain backward compatibility with `.env` files

### API Changes

- Added `GET /api/settings` - List all settings with optional category filtering
- Added `GET /api/settings?grouped=true` - Get settings grouped by category
- Added `GET /api/settings/:key` - Get single setting with type casting
- Added `PUT /api/settings/:key` - Create/update setting (admin only)
- Added `DELETE /api/settings/:key` - Delete non-system setting (admin only)
- All endpoints documented with Swagger/OpenAPI annotations

### Infrastructure

- New environment variables:
  - `REFERENCE_UPDATE_METHOD` (url|file|disabled)
  - `REFERENCE_UPDATE_LOCATION` (URL or file path)
- Created `data/reference.json` for development/testing
- Added app settings migration (20251206140000-create-app-settings-table.js)
- Cron job for reference data updates (twice daily)
- Updated reporting and purge cron jobs to use app settings

### Documentation

- Added docs/app-settings.md - Comprehensive app settings documentation
- Added "Upgrading" section to README.md with production deployment steps
- Documented reference data update system
- Listed future settings migration candidates
- Added Swagger documentation for all settings endpoints

### Notes

- Settings updates take effect immediately without application restart
- Reference data system provides centralized version management for all VULNZ installations
- System settings cannot be deleted but can be updated
- All version comparisons now use database-backed thresholds instead of hardcoded values

---

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
