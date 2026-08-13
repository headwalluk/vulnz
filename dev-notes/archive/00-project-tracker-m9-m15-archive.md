# VULNZ API — Archived Milestones (M9–M15)

Completed milestones, archived 2026-08-13 to keep the active tracker focused on in-flight work. Every one of these is complete and live on production. Retained here for historical context — the reasoning behind each is in its design note, and the user-facing detail is in the CHANGELOG.

Earlier milestones are in [`00-project-tracker-m1-m6-archive.md`](00-project-tracker-m1-m6-archive.md).

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

## M10 — Web UI Decommission & Status Landing Page ✅

**Status:** complete — v1.31.0, **live on prod** (deployed 2026-04-11; vulnz-woo and vulnz-ingest both verified working against it afterwards)

> Archive note: the status line below was left at "ready to deploy" in the active tracker long after the work actually shipped, and M10.17 was never ticked. Corrected here on archiving, 2026-08-13.

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

- [x] **M10.1** — Audit current UI surface: list every view template, static asset directory, UI-only route, session-dependent middleware, and UI-related env var. Capture in a short inventory note before starting deletions so we can refer back if anything unexpected breaks
- [x] **M10.2** — Delete the search-box view and any other public/admin page routes; remove view template files and static asset directories wholesale
- [x] **M10.3** — Remove Passport LocalStrategy, `express-session`, the MySQL session store middleware, and related session wiring from `src/index.js`
- [x] **M10.4** — Remove `src/models/session.js` and create a migration to drop the `sessions` table
- [x] **M10.5** — Remove `src/models/passwordResetToken.js`, create a migration to drop the `password_reset_tokens` table, remove the reset email template, and delete the reset routes in `src/routes/auth.js`. The `user:reset-password` CLI command remains untouched
- [x] **M10.6** — Rename `apiOrSessionAuth` → `apiAuth` (and `optionalApiOrSessionAuth` → `optionalApiAuth`) in `src/middleware/` and update every route that uses them. Simplify the middleware body to API-key-only — no session fallback
- [x] **M10.7** — Remove `SESSION_SECRET`, `SESSION_DURATION_DAYS`, `PASSWORD_RESET_TOKEN_DURATION`, and `PASSWORD_MIN_*` from `src/lib/env.js` and `.env.example`. Remove any code that reads them
- [x] **M10.8** — Remove newly-unused dependencies from `package.json`: `passport`, `passport-local`, `express-session`, the session store package, and the view engine (EJS/Pug/whichever is in use). Keep `passport` + `passport-http-header-strategy` if the API key strategy depends on them — double-check before removing. Run `npm prune` and commit the updated lockfile
- [x] **M10.9** — Build the new `/` route mirroring [`verifytrusted-api-front-page.png`](verifytrusted-api-front-page.png). HTML response contains: Vulnz logo, title ("VULNZ API"), version (read dynamically from `package.json`), tagline ("Self-hosted vulnerability database for WordPress plugins, themes, and npm packages"), a "System Operational" status pill (green when healthy), and a 2×2 button grid linking to: Health Check (`/health` or `/api/health` — whichever exists), GitHub Repo (link to the repo URL from `package.json`), API Documentation (Swagger UI), OpenAPI Spec (`/openapi.json`). Footer with copyright. Single self-contained HTML file with inline CSS — no build step, no frontend framework
- [x] **M10.10** — Add content negotiation: when `Accept: application/json`, return a JSON object with the same core fields (`name`, `version`, `tagline`, `status`, `links: { health, github, swaggerUi, openapi }`). Agents and `curl` get structured data; browsers get the HTML page
- [x] **M10.11** — Verify the Swagger UI HTML mount is intact at its existing path (likely `/api-docs`) and that `/openapi.json` still serves the generated spec. Link both from the landing page
- [x] **M10.12** — Update tests: delete web-UI/session test files, remove session-auth cases from API route tests, ensure every route test authenticates via API key only. Target: all existing non-UI tests still pass
- [x] **M10.13** — Add tests for the new `/` landing page: HTML response contains expected elements (title, version, all four buttons), JSON response matches the expected shape, version is read from `package.json` not hardcoded, status pill reflects actual health
- [x] **M10.14** — Update `CLAUDE.md`, `AGENTS.md`, `README.md`, and `dev-notes/03-architecture-overview.md` to reflect the CLI + API-only shape. Remove references to the web UI, session auth, password reset flow, and `SETUP_MODE`. Note that admin UI is now the `vulnz-woo` WordPress plugin
- [x] **M10.15** — Update `dev-notes/05-security-patterns.md` to reflect API-key-only auth, remove session security notes
- [x] **M10.16** — Bump version (minor bump) and update the CHANGELOG with a clear breaking-change note. Document the migration path for anyone who had been using the web UI: use the CLI, or use vulnz-woo
- [ ] **M10.17** — Deploy to dev, verify the landing page renders correctly in a browser, verify JSON negotiation with `curl -H "Accept: application/json" http://localhost:3020/`, verify a sample of API endpoints still work with an API key, then deploy to prod and soak for 24–48 hours before starting M11. **Partially done**: local smoke test completed against the real dev MariaDB (migrations ran, landing page HTML/JSON both render, `/doc`, `/openapi.json`, `/api/ping`, favicon all serve correctly). Pending: merge `m10-ui-decommission` to `main`, deploy to the dev host, deploy to prod, soak

---

## M12 — Fast Update Triggers ✅

**Status:** complete — v1.32.0 (2026-07-23)

Fleet fast-update manifest so ~320 sites across 10 servers can patch a critical WordPress/plugin release within the hour instead of waiting for the overnight cycle. Full design and as-built notes in [`12-fast-update-triggers.md`](12-fast-update-triggers.md).

- [x] **M12.1** — `sync_priorities` lookup table + `components.sync_priority_slug` / `latest_version` / `latest_version_at` / `wporg_available` (migration + `tests/setup.js`)
- [x] **M12.2** — Two wporg sync lanes: hourly high-priority (`syncHighPriorityPlugins`) + existing low rotation; capture `data.version` → `latest_version` + release upsert + availability
- [x] **M12.3** — Watchlist builder (`src/lib/watchlist.js`): static ∪ top-N watchable by prod install count; blind-spot reporting; on-demand availability probing
- [x] **M12.4** — WordPress core version sync (`src/lib/wpcore.js`) from stable-check → dynamic `wordpress.current_version` + `wordpress.safe_versions`; `classifyWordPressVersion()`. **Fixed the stale-version root cause** (`data/reference.json` hardcoded 6.9)
- [x] **M12.5** — `GET /api/wordpress/latest-versions` manifest route (apiAuth, cache headers, Swagger)
- [x] **M12.6** — Crons (high/core/watchlist) + startup core sync + 4 CLI commands
- [x] **M12.7** — 32 new tests (268 passing), `.env.example`, docs
- [ ] **Deferred:** theme support (child-theme filtering unresolved); weekly-report insecure-vs-outdated split using `classify()`; the 55 unfixable-bundled-plugin sites

**Chips at M7:** added `parseStr()` to `env.js`; `wporg.js` moved off raw `process.env`.

---

## M13 — Urgent Update Classification ✅

**Status:** complete — v1.33.0 (2026-07-24), **live on prod and enabled** (first run: 26/26 classified, 4 urgent, all verified correct — see [`14-urgent-updates.md`](14-urgent-updates.md) §7)

Adds `is_urgent` to the fast-update manifest so the fleet can distinguish an emergency security release from routine work. Without it, M12's manifest would force an out-of-cycle update for every release — too aggressive and too noisy to run. Design and as-built notes in [`14-urgent-updates.md`](14-urgent-updates.md).

- [x] **M13.1** — `urgency_sources` lookup table + `releases.changelog` / `is_urgent` / `urgency_summary` / `urgency_source_slug` / `urgency_checked_at` (migration + `tests/setup.js`; DDL validated against dev MariaDB on scratch tables)
- [x] **M13.2** — `src/lib/llm/` provider-agnostic layer: OpenRouter client (timeout, retry on 429/5xx only, defensive JSON extraction) + task registry designed for additional prompts
- [x] **M13.3** — `release-urgency` task: prompt scoped to "exploitable against a default installation", explicitly excluding dependency-advisory bumps and admin-only issues
- [x] **M13.4** — `src/lib/urgency.js`: pending queue, keyword override (raises only), verdict persistence
- [x] **M13.5** — Changelog capture in the high-priority wporg lane (fast lane only); `is_urgent` + `summary` on the manifest; `generated_at` accounts for verdicts
- [x] **M13.6** — Hourly `20 * * * *` cron + 3 CLI commands (`llm:status`, `llm:classify-release`, `llm:classify-pending`)
- [x] **M13.7** — 24 new tests (297 passing), `.env.example`, CLI reference, feature guide, design note
- [x] **M13.8** — `db:migrate` CLI command (migrations previously ran only at API startup, so the CLI could not be used against an un-migrated database)
- [x] **M13.9** — Verified live on dev: migration applied, 6 watchlist releases classified against OpenRouter/Haiku 4.5, both directions probed with crafted changelogs, re-sync confirmed idempotent
- [ ] **Deferred:** tier-2 vulnerability-feed backfill (`patched_in` + severity via `vulnz-ingest`, to catch silently-patched releases); `urgent_since` for the multi-version-behind case; notification on urgent classification

**Next action:** M13 is done and live. The follow-on work is **fleet-side** (`/opt/scripts`, separate repo): teach `wordpress_is_auto_update_due()` to act on `is_urgent` rather than on version drift alone, keeping the existing `wp-update.is-disabled` and `hw_block_updates` guards winning over an urgent trigger. Four real urgent entries are live in the manifest to test against.

---

## M14 — Known Malware Flagging ✅

**Status:** complete — v1.34.0 (2026-08-12), **live on prod** (deployed 2026-08-13, verified against the public search endpoint on `api.vulnz.net`)

Fake plugins dropped by an attacker were ingested by the normal fleet path and read back completely clean: they appear in neither wordpress.org nor Wordfence, so nothing ever contradicted the default. Adds a component-level `is_malware` verdict that covers every version, present and future. Design and as-built notes in [`15-known-malware.md`](15-known-malware.md).

- [x] **M14.1** — `malware_sources` lookup table + `components.is_malware` / `malware_summary` / `malware_source_slug` / `malware_flagged_at` (migration + `tests/setup.js`; applied to dev MariaDB)
- [x] **M14.2** — Model layer: `flagAsMalware` / `clearMalwareFlag` / `findMalware` / `findByTypeAndSlug`, plus `malwareTaintsReleases()` as the single seam for the `has_vulnerabilities` coupling
- [x] **M14.3** — `is_malware` + `malware_summary` on all four read paths; **search first**, since vulnz.net's browser search is where a fake plugin reading clean is most visible
- [x] **M14.4** — `probeWpOrgSlug()`: read-only, non-mutating wordpress.org lookup, so the CLI can refuse to flag a slug squatting on a real plugin
- [x] **M14.5** — 3 CLI commands (`component:malware:add` / `:remove` / `:list`); writes are CLI-only by design — no API route sets these columns
- [x] **M14.6** — 37 new tests (334 passing), API usage guide, CLI reference, design note, snag-list entry for the `has_vulnerabilities` coupling
- [x] **M14.7** — Verified live on dev: `easypost` flagged, guard correctly refused `contact-form-7`, search returns `is_malware: true`, a never-before-seen version auto-created on lookup inherits the flag
- [ ] **Deferred:** malware alerts in the report emails (the fleet reads its data out of the reports, so this is what closes the loop); `malware: [...]` array on the fleet manifest for proactive sweeps; dropping the `has_vulnerabilities` coupling

**Next action:** M14 is done and live. The follow-on work is the **report emails** — a known-malware detection on a customer site warrants a strong emergency alert, not a row in the vulnerability table. That is what closes the loop, because the fleet does not read data out of VULNZ; it acts on the reports. Doing it is also the precondition for dropping the `has_vulnerabilities` coupling (snag list).

**Note on numbering:** M14 was previously pencilled in for premium plugin version sources (paused 2026-07-29, never written into this tracker). That work needs a new number.

---

## M15 — Malware Detection on Websites ✅

**Status:** complete — v1.35.0 (2026-08-13), **live on prod** (immediate alert verified there against a synthesised website update carrying `easypost`)

M14 made it possible to say a component is malware. M15 answers the operational question that follows: which sites are carrying it? Two independent routes to that answer — an immediate email when a sync reports one, and an authenticated endpoint to poll if the email is missed. Notes in [`15-known-malware.md`](15-known-malware.md#8-m15--detection-on-websites-v1350).

- [x] **M15.1** — `website_malware_alerts` table + `src/models/websiteMalware.js` (migration + `tests/setup.js`; applied to dev MariaDB)
- [x] **M15.2** — `GET /api/websites/malware`: live join, owner-scoped, registered ahead of `/:domain`
- [x] **M15.3** — Immediate alert: `malware-alert.hbs`, `sendMalwareAlert()`, `src/lib/malwareAlert.js`, hooked into the website update path
- [x] **M15.4** — Per-(website, component) dedup with re-infection detection; `MALWARE_ALERT_ENABLED` / `MALWARE_ALERT_EMAIL`
- [x] **M15.5** — 20 new tests (354 passing), `.env.example`, API usage guide, design note
- [x] **M15.6** — `component_changes` added to the SQLite test schema, making the website update path testable end to end for the first time
- [ ] **Deferred:** per-site contact routing for the alert (needs contact data that does not exist yet); malware as its own category in the report emails

**Next action:** M15 is done and live. Next is the **report emails** — the piece that reaches customers rather than just the operator, and the precondition for dropping the `has_vulnerabilities` coupling.
