# VULNZ API — Project Tracker

**Lead:** Paul Faulkner <paul@headwall-hosting.com>
**Last updated:** 2026-04-11

## Current Status

M9 bulk releases endpoint built and round-trip tested with vulnz-ingest WordPress.org feed on dev server. 16 new tests (246 total passing). Dependencies updated, nodemailer SMTP injection vulnerability patched.

MCP server initiative kicked off — requirements captured in [`11-mcp-server-requirements.md`](11-mcp-server-requirements.md). Preparing the codebase for MCP work by decommissioning the legacy web UI first.

**Priority order:** M10 (UI decommission) → M11 (MariaDB test DB) → M7 (env cleanup) → M8 (legacy columns) → MCP layers (new milestones to be defined from the requirements doc).

**Next action:** Ship M10 — strip the web UI, drop the session subsystem, replace `/` with a minimal status landing page. This is the prerequisite for a cleaner MCP build on top of a slimmer CLI + API core. M11 follows immediately after, replacing the in-memory SQLite test shim with a real MariaDB test database to eliminate the dev/prod inconsistency before M7's env-var work (which benefits from accurate DB semantics).

Completed milestones M1–M6 have been archived to [`archive/00-project-tracker-m1-m6-archive.md`](archive/00-project-tracker-m1-m6-archive.md).

---

## M7 — Environment Variable Normalization Cleanup

**Status:** not started

~40 env vars across 13 files bypass `src/lib/env.js` and use raw `process.env` access with inline `parseInt`/string comparison. Violates the project's no-direct-`process.env` rule. Risk: NaN bugs from misconfigured integers, boolean parsing failures (`'True'`/`'1'`/`'yes'` all silently fail), and no startup validation for critical vars like `SESSION_SECRET`.

- [ ] **M7.1** — Normalize integer env vars in `env.js`: `SESSION_DURATION_DAYS`, `PASSWORD_RESET_TOKEN_DURATION`, `PASSWORD_MIN_*` (6 vars), `REPORTING_HOUR`, `REPORTING_BATCH_SIZE`, `WPORG_RESYNC_DAYS`, `WEBSITE_AUTO_DELETE_DAYS`, `API_LOG_RETENTION_DAYS`, `MAX_API_KEYS_PER_USER`, `HTTP_LISTEN_PORT`, `WPORG_TIMEOUT_MS`, `WPORG_UPDATE_BATCH_SIZE`
- [ ] **M7.2** — Normalize boolean env vars in `env.js`: `CORS_ENABLED`, `CORS_CREDENTIALS`, `WEBSITE_AUTO_DELETE_ENABLED`, `SMTP_IGNORE_TLS`
- [ ] **M7.3** — Normalize enum env vars in `env.js`: `SERVER_MODE`, `REFERENCE_UPDATE_METHOD`
- [ ] **M7.4** — Normalize string env vars in `env.js` with validation where appropriate: `BASE_URL`, `SESSION_SECRET`, `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`, `DB_HOST`/`USER`/`PASSWORD`/`NAME`, `CORS_ORIGIN`, `VULNZ_NOTIFY_SECRET`, `GEOIP_DATABASE_PATH`, `WPORG_API_BASE_URL`/`PLUGIN_INFO_ENDPOINT`/`USER_AGENT`, `REPORTING` text vars, `EXAMPLE_WP_COMPONENT_*`
- [ ] **M7.5** — Replace all raw `process.env` reads in `src/` with normalized values — update `index.js`, `config/db.js`, `lib/email.js`, `lib/geoip.js`, `lib/passwordValidation.js`, `lib/referenceData.js`, `lib/reporting.js`, `lib/wporg.js`, `middleware/notifyAuth.js`, `models/apiCallLog.js`, `models/user.js`, `routes/auth.js`, `routes/config.js`
- [ ] **M7.6** — Update `.env.example` with any missing vars and add validation notes
- [ ] **M7.7** — Tests: ensure test suite still passes with normalized env vars, add `jest.setup.js` entries for any new required vars

---

## M8 — Remove Legacy Website Version Columns

**Status:** not started

Since v1.29.2 `platform_metadata` and the legacy version columns (`wordpress_version`, `php_version`, `db_server_type`, `db_server_version`, `versions_last_checked_at`) are kept in sync. This milestone removes the legacy columns entirely, making `platform_metadata` the single source of truth.

**Prerequisite:** all API consumers (vulnz-woo plugin, vulnz-sensor) must be updated to read from `platform_metadata` before the columns are dropped.

- [ ] **M8.1** — Audit all API consumers (vulnz-woo plugin, vulnz-sensor, vulnz-ingest) to confirm they read/write `platform_metadata` rather than the legacy version fields. Document any that still depend on the old fields
- [ ] **M8.2** — Update API response (`tidyWebsite`) to populate `wordpress_version`/`php_version`/`db_server_type`/`db_server_version` from `platform_metadata` instead of the DB columns, so the response shape stays stable while the underlying source changes
- [ ] **M8.3** — Refactor `updateVersions()` in website model to write only to `platform_metadata` (remove direct column writes and the `JSON_SET` sync). Update the PUT route platform→version sync to stop writing to legacy columns
- [ ] **M8.4** — Refactor `findOutdatedWordPress()` and `findOutdatedPhp()` to query `platform_metadata` JSON fields instead of the legacy columns
- [ ] **M8.5** — Refactor `getVersionDistribution()` to aggregate from `platform_metadata` JSON fields instead of the legacy columns
- [ ] **M8.6** — Update `reporting.js` to read version data from `platform_metadata` instead of the legacy columns
- [ ] **M8.7** — Deprecate `PUT /api/websites/:domain/versions` endpoint — update Swagger docs with deprecated flag, add `console.warn` on use, point callers to the `platform` field in `PUT /api/websites/:domain`
- [ ] **M8.8** — Update all tests: replace legacy column assertions with `platform_metadata` assertions, update test schema (remove columns from `tests/setup.js`), update mocks
- [ ] **M8.9** — Create migration to drop legacy columns: `wordpress_version`, `php_version`, `db_server_type`, `db_server_version`, `versions_last_checked_at` from the `websites` table
- [ ] **M8.10** — Remove `VERSION_TO_PLATFORM_KEY`/`PLATFORM_KEY_TO_VERSION` mapping constants and all remaining sync code added in v1.29.2
- [ ] **M8.11** — Update documentation: CHANGELOG, database schema doc, architecture overview, Swagger response schemas

---

## M9 — Bulk Releases Endpoint ✅

**Status:** complete (v1.30.0)

New API endpoint to receive bulk component+version (release) data from external ingest tools. The Wordfence ingest creates releases only for vulnerable versions. This endpoint allows vulnz-ingest to also register non-vulnerable releases discovered from WordPress.org's recently-updated feed, giving a complete picture of a plugin's release history. Modelled after `POST /api/vulnerabilities/bulk` but creates only components+releases (no vulnerability URLs required).

Round-trip tested 2026-04-10 against dev server with vulnz-ingest WordPress.org feed: 9,841 releases created across 250 plugins, deduplication confirmed on second run.

- [x] **M9.1** — Design endpoint contract: `POST /api/releases/bulk` accepting `{ items: [{ componentTypeSlug, componentSlug, version, releaseDate? }] }` with max 500 items per request. Auth via `apiOrSessionAuth`. Response: `{ created, duplicates, errors }`
- [x] **M9.2** — Create route in `src/routes/releases.js` with validation: require `componentTypeSlug`, `componentSlug`, `version` per item. Validate `componentTypeSlug` exists. Sanitize slugs and versions using existing sanitizer helpers. Reject batch if items > 500
- [x] **M9.3** — Implement batch processing: auto-create components (`INSERT IGNORE` pattern), auto-create releases (`INSERT IGNORE` pattern). Use in-request caching (Maps) for component type and component lookups, matching the pattern in `POST /api/vulnerabilities/bulk`
- [x] **M9.4** — Register route in `src/index.js` with `app.use('/api/releases', releasesRouter)`. Add `apiOrSessionAuth` and `logApiCall` middleware
- [x] **M9.5** — Add Swagger JSDoc comments to the route with full request/response schema documentation
- [x] **M9.6** — Write tests in `tests/api/releases.test.js`: auth required, validation errors, successful bulk create, duplicate handling, component auto-creation, max items limit, mixed valid/invalid items. 16 tests, all passing.
- [x] **M9.7** — Add `bulkCreateReleases()` method to `VulnzClient` in vulnz-ingest project (`src/api/vulnz-client.js`) so ingest feeds can push to the new endpoint
- [x] **M9.8** — Update documentation: CHANGELOG, database schema doc, Swagger/OpenAPI output verification

---

## M10 — Web UI Decommission & Status Landing Page

**Status:** not started — **immediate priority**

Decommission the legacy admin web UI, leaving vulnz-api as a clean CLI + API core. This is the prerequisite for MCP work (see [`11-mcp-server-requirements.md`](11-mcp-server-requirements.md)): slimming the codebase before layering on new functionality, and removing the session-auth dual path that complicates every middleware.

Admin functionality that was previously handled via the web UI moves to two places going forward:
- **CLI** (`bin/vulnz.js`) — where it already lives for user, key, site, queue, and setting management.
- **vulnz-woo WordPress plugin** — the WP admin area becomes the primary customer-facing admin UI. Missing functionality will be added to that plugin as needed, not to vulnz-api. The only things the legacy vulnz-api UI was being used for were login, checking website ownership, and occasionally reassigning website ownership — none of which justify keeping the UI alive.

The `/` route — currently a search box — will be replaced with a minimal status landing page mirroring the layout in [`verifytrusted-api-front-page.png`](verifytrusted-api-front-page.png): logo, title, version, tagline, a "System Operational" status pill, and a 2×2 button grid. Content-negotiated — HTML for browsers, JSON for `Accept: application/json` so curl and agents get structured data.

**Scope overlap with M7:** this milestone subsumes the removal of session-related env vars (`SESSION_SECRET`, `SESSION_DURATION_DAYS`, `PASSWORD_RESET_TOKEN_DURATION`, `PASSWORD_MIN_*`). M7 picks up the remaining ~35 env var normalisations after this lands.

**Resolved prerequisites:**

- ✅ Sessions: fully removed. Passport LocalStrategy, `express-session`, the MySQL session store, the `sessions` table, and `src/models/session.js` all go.
- ✅ Password reset: email-based flow fully removed. `passwordResetToken` model + table, email template, and reset routes all go. CLI `user:reset-password` remains the only way to reset a password.
- ✅ Swagger: **both** `openapi.json` and the Swagger UI HTML are retained. The spec is machine-readable for MCP/tooling; the UI is human-readable for developers. Both are API documentation, not admin UI.
- ✅ Landing page: HTML with content-negotiated JSON response. Mirrors the VerifyTrusted layout — no live DB stats in v1 (keep it simple; add later if useful).

### Tasks

- [ ] **M10.1** — Audit current UI surface: list every view template, static asset directory, UI-only route, session-dependent middleware, and UI-related env var. Capture in a short inventory note before starting deletions so we can refer back if anything unexpected breaks
- [ ] **M10.2** — Delete the search-box view and any other public/admin page routes; remove view template files and static asset directories wholesale
- [ ] **M10.3** — Remove Passport LocalStrategy, `express-session`, the MySQL session store middleware, and related session wiring from `src/index.js`
- [ ] **M10.4** — Remove `src/models/session.js` and create a migration to drop the `sessions` table
- [ ] **M10.5** — Remove `src/models/passwordResetToken.js`, create a migration to drop the `password_reset_tokens` table, remove the reset email template, and delete the reset routes in `src/routes/auth.js`. The `user:reset-password` CLI command remains untouched
- [ ] **M10.6** — Rename `apiOrSessionAuth` → `apiAuth` (and `optionalApiOrSessionAuth` → `optionalApiAuth`) in `src/middleware/` and update every route that uses them. Simplify the middleware body to API-key-only — no session fallback
- [ ] **M10.7** — Remove `SESSION_SECRET`, `SESSION_DURATION_DAYS`, `PASSWORD_RESET_TOKEN_DURATION`, and `PASSWORD_MIN_*` from `src/lib/env.js` and `.env.example`. Remove any code that reads them
- [ ] **M10.8** — Remove newly-unused dependencies from `package.json`: `passport`, `passport-local`, `express-session`, the session store package, and the view engine (EJS/Pug/whichever is in use). Keep `passport` + `passport-http-header-strategy` if the API key strategy depends on them — double-check before removing. Run `npm prune` and commit the updated lockfile
- [ ] **M10.9** — Build the new `/` route mirroring [`verifytrusted-api-front-page.png`](verifytrusted-api-front-page.png). HTML response contains: Vulnz logo, title ("VULNZ API"), version (read dynamically from `package.json`), tagline ("Self-hosted vulnerability database for WordPress plugins, themes, and npm packages"), a "System Operational" status pill (green when healthy), and a 2×2 button grid linking to: Health Check (`/health` or `/api/health` — whichever exists), GitHub Repo (link to the repo URL from `package.json`), API Documentation (Swagger UI), OpenAPI Spec (`/openapi.json`). Footer with copyright. Single self-contained HTML file with inline CSS — no build step, no frontend framework
- [ ] **M10.10** — Add content negotiation: when `Accept: application/json`, return a JSON object with the same core fields (`name`, `version`, `tagline`, `status`, `links: { health, github, swaggerUi, openapi }`). Agents and `curl` get structured data; browsers get the HTML page
- [ ] **M10.11** — Verify the Swagger UI HTML mount is intact at its existing path (likely `/api-docs`) and that `/openapi.json` still serves the generated spec. Link both from the landing page
- [ ] **M10.12** — Update tests: delete web-UI/session test files, remove session-auth cases from API route tests, ensure every route test authenticates via API key only. Target: all existing non-UI tests still pass
- [ ] **M10.13** — Add tests for the new `/` landing page: HTML response contains expected elements (title, version, all four buttons), JSON response matches the expected shape, version is read from `package.json` not hardcoded, status pill reflects actual health
- [ ] **M10.14** — Update `CLAUDE.md`, `AGENTS.md`, `README.md`, and `dev-notes/03-architecture-overview.md` to reflect the CLI + API-only shape. Remove references to the web UI, session auth, password reset flow, and `SETUP_MODE`. Note that admin UI is now the `vulnz-woo` WordPress plugin
- [ ] **M10.15** — Update `dev-notes/05-security-patterns.md` to reflect API-key-only auth, remove session security notes
- [ ] **M10.16** — Bump version (minor bump) and update the CHANGELOG with a clear breaking-change note. Document the migration path for anyone who had been using the web UI: use the CLI, or use vulnz-woo
- [ ] **M10.17** — Deploy to dev, verify the landing page renders correctly in a browser, verify JSON negotiation with `curl -H "Accept: application/json" http://localhost:3020/`, verify a sample of API endpoints still work with an API key, then deploy to prod and soak for 24–48 hours before starting M11

---

## M11 — MariaDB Test Database Migration

**Status:** not started — **follows M10**

Replace the in-memory SQLite test backend with a real local MariaDB test database. The current setup uses `tests/setup.js` to stand up in-memory SQLite and apply a MySQL→SQLite SQL translation shim. This was convenient for speed and zero-config, but it creates a real dev/prod inconsistency: tests exercise SQLite semantics, production runs MariaDB, and a class of bugs (BigInt handling, JSON functions, FULLTEXT indexes, `INSERT IGNORE` semantics, CHAR padding, boolean parsing) can pass in tests and fail in prod.

M10 shrinks the test surface first — UI tests, session tests, and password-reset tests all disappear — so the migration lands against a smaller, cleaner suite.

**Rationale for sequencing before M7:** M7 normalises ~40 env vars including booleans and enum-like strings. MariaDB and SQLite parse these differently, and the env-cleanup work benefits from running against accurate DB semantics.

### Tasks

- [ ] **M11.1** — Create `vulnz_t` database on local dev MariaDB. Grant the existing dev DB user access to it, or create a dedicated test user
- [ ] **M11.2** — Add `.env.test` template file (documented, not committed — add to `.gitignore` alongside `.env`). Update `jest.setup.js` (or equivalent) to load `.env.test` when `NODE_ENV=test`
- [ ] **M11.3** — Remove the MySQL→SQLite translation shim from `tests/setup.js`. Rip out the `better-sqlite3` dependency from `package.json`
- [ ] **M11.4** — Rewrite `createTestDatabase()` and `cleanupTestDatabase()` to use MariaDB. Swap the between-test reset strategy from DROP/CREATE (expensive on real MariaDB) to `TRUNCATE TABLE` with `SET FOREIGN_KEY_CHECKS=0` around it
- [ ] **M11.5** — Audit all tests for SQLite-specific assumptions: FULLTEXT search behaviour, JSON function differences, CHAR padding, NULL comparison, `INSERT IGNORE` vs `INSERT ... ON DUPLICATE KEY`, case sensitivity. Fix any tests that were written against the wrong semantics — these are latent bugs
- [ ] **M11.6** — Verify all tests pass against real MariaDB. Document any tests where behaviour differed and required fixes
- [ ] **M11.7** — Update `dev-notes/06-testing-guide.md` with new setup instructions: how to create the test DB, how to configure `.env.test`, how tests isolate between files
- [ ] **M11.8** — Update `CLAUDE.md` and `AGENTS.md` to remove references to the SQLite shim and document the new MariaDB-required test setup
- [ ] **M11.9** — If CI is in use, update the CI config to provision a MariaDB service container before running tests
- [ ] **M11.10** — Update CHANGELOG with a developer-facing note about the test setup change, and mention in the README that running tests now requires a local MariaDB instance
