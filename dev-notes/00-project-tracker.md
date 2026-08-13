# VULNZ API — Project Tracker

**Lead:** Paul Faulkner <paul@headwall-hosting.com>
**Last updated:** 2026-08-13 (end of the malware session — v1.34.0 → v1.37.0)

## Current Status

The current line of work is **known malware**. M14 added a component-level `is_malware` flag set only via the CLI; M15 added the ability to find which websites are carrying it, plus an immediate email alert when a sync reports one; v1.36.0 made the signals honest and v1.37.0 fixed search rate limiting for the browser search box.

Two fake plugins found on the hosting fleet are flagged on prod and dev: `easypost` and `wp-core-sync`, both backdoor file droppers.

> ### ⚠️ Prod is behind: running **v1.35.0**, latest tag is **v1.37.0**
>
> v1.36.0 and v1.37.0 are committed, tagged and pushed but **not deployed**. Both have migrations that run on startup — a `malware_url` column and an HTML-entity decode of existing `websites.title` values. Deploying is the first thing to do next session.
>
> Deploying v1.36.0 changes an API contract: a malware component no longer reports `has_vulnerabilities: true`. **Unverified:** whether `vulnz-woo` or `/opt/scripts` infer malware from that field. Check before or immediately after deploying — see M16.11.

**Next up: M16 — malware alerts for customers.** M16.1 (decided) and M16.11 (done early, in v1.36.0) are complete; the remaining work is routing the immediate alert to the site owner and adding a malware block to the weekly report. This is the piece that reaches customers rather than just the operator.

**In flight elsewhere (2026-08-13):** browser JS for the `vulnz.net/search/` page and WordPress-side work, both in other repos. They consume `is_malware` / `malware_summary` / `malware_url` from the search endpoint. Anything the API needs to hand them that it does not yet may land as small follow-ups.

**Priority order:** deploy v1.37.0 → M16 (customer alerts) → M11 (MariaDB test DB) → M7 (env cleanup) → M8 (legacy columns).

Tech debt and small rough edges live in [`13-snag-list.md`](13-snag-list.md), not here.

Completed milestones are archived: [M1–M6](archive/00-project-tracker-m1-m6-archive.md), [M9–M15](archive/00-project-tracker-m9-m15-archive.md).

---

## M16 — Malware Alerts for Customers

**Status:** not started — **next up**

**Decision (2026-08-13, Paul):** a malware detection **forces an immediate email to the site's owner** — it does not wait for that user's weekly report slot. M15's alert channel was shipped operator-only on purpose, so its real-world behaviour could be judged against a live inbox before it was ever pointed at a customer. That judgement is now made: it works, so it gets routed to customers.

This widens M16 beyond "add a block to the weekly report". Per-site contact routing was previously deferred; it is now the core of this milestone.

### The constraint that governs the whole design

Paul's requirement, and the thing to weigh every decision here against:

> Emails from VULNZ need to be **eye-catching, quick to analyse, and trustworthy.** What must not happen is customers receiving false positives — they will tune the alerts out, or filter them to a folder, and then the one that matters is never read.

An alert channel's value is entirely spent the first time it cries wolf. Two mechanisms already protect this and must not be weakened:

1. **The wordpress.org slug-squatting guard** (`component:malware:add`) — the only realistic source of a false positive is a human flagging a slug that a legitimate plugin also uses. That guard is what stands between a typo and every customer running that plugin being told they are compromised.
2. **Per-(website, component) dedup** — the same alert never repeats, which is what stops the channel becoming background noise.

A corollary worth stating: because customer-facing alerts raise the cost of a mistake sharply, `--force` on `component:malware:add` should be treated as a deliberate, checked action from here on, not a way past an inconvenient guard.

The weekly report is currently **completely blind to known malware.** This is not a cosmetic gap, and it is worth being precise about why, because it is not what you would assume from M14:

- `website.findAll(..., onlyVulnerable = true)` — the query that decides which sites appear in the report at all — does an **INNER JOIN on `vulnerabilities`** (`src/models/website.js:28`). A site whose only problem is malware has no vulnerability rows, so it never enters the report.
- `websiteComponent.getComponents()` computes `has_vulnerabilities` purely from that same vulnerabilities join (`src/models/websiteComponent.js:30-59`). It does not consult `is_malware`.

M14's `has_vulnerabilities` coupling was applied in `component.search()` and in `src/routes/components.js` — the **component** read paths. It was never applied to the **website→component** path the report is built from. So flagging a component today changes nothing whatsoever in any customer's weekly email.

Goal: a known-malware detection on a customer's site is reported as an emergency in its own right — visually distinct, at the top, and never mixed in with routine "these plugins have CVEs" rows. Malware and vulnerability are different statements and should not be presented as the same thing.

- [x] **M16.1** — ~~Decide the reporting rule~~ **Decided:** malware forces an immediate email to the site's owner, independent of the weekly cycle (see above)
- [ ] **M16.2** — Route the immediate alert to the website's owner. The recipient already resolves without new schema: `websites.user_id` → `users.reporting_email` falling back to `users.username`, the same rule `sendSummaryEmail()` uses. Keep `MALWARE_ALERT_EMAIL` as an operator copy on every alert rather than replacing it — Paul wants to keep seeing what customers see
- [ ] **M16.3** — Split the alert template: `malware-alert.hbs` currently addresses an operator ("Sent by VULNZ because…", an API endpoint reference, the account name of the owner). A customer needs different wording, no internal references, and the white-label treatment the weekly report already applies. Either branch inside the template on an `isOperator` flag or use two templates — two templates is probably cleaner given how much of the body differs
- [ ] **M16.4** — Decide what happens for a site whose owner is an administrator, or has no usable email: fall back to the operator address only, and never fail silently. `validateEmailAddress()` already exists for the address check
- [ ] **M16.5** — Extend the report data assembly in `src/lib/reporting.js` (`sendSummaryEmail`, around lines 76–120) so the weekly report also carries anything still outstanding. `websiteMalware.findAffectedWebsites(userId)` already returns exactly this, owner-scoped — reuse it rather than writing new SQL. The immediate alert is the primary channel; the weekly report is the backstop for anything not yet cleaned up
- [ ] **M16.6** — Make sure malware-only sites reach the weekly report: either widen `website.findAll`'s `onlyVulnerable` join (careful — it is used by `GET /api/websites?only_vulnerable=`, so changing it changes API behaviour too) or union the malware sites in at the reporting layer. Prefer the reporting layer unless the API change is wanted deliberately
- [ ] **M16.7** — Add a malware block to `src/emails/vulnerability-report.hbs`, above the executive summary. Distinct treatment (the red `#991B1B` used by `malware-alert.hbs` is the established colour), listing domain, component slug, version, and `malware_summary`. State plainly that updating will not fix it — every version is flagged — and that the component must be removed and the site checked for anything it dropped
- [ ] **M16.8** — Add malware to `executiveSummary` so the "all clear" wording cannot appear while malware is present, and adjust the subject line in `sendVulnerabilityReport()` (`src/lib/email.js`) — "Attention Required!" understates a backdoor
- [ ] **M16.9** — White-label: `user.enable_white_label` / `white_label_html` change the report header. Both the customer alert and the report block must read correctly under a customer's own branding
- [ ] **M16.10** — Tests: the site owner receives the immediate alert and the operator gets a copy; a missing or invalid owner address falls back to the operator without failing; dedup still holds across both recipients; a malware-only site (no vulnerabilities at all) reaches the weekly report; the "all clear" path cannot trigger with malware present
- [x] **M16.11** — **Done in v1.36.0, ahead of the rest of the milestone.** Retired the `has_vulnerabilities` coupling: `malwareTaintsReleases()` and both call sites deleted, snag-list item closed. Also added per-component `is_malware` / `malware_summary` / `malware_url` / `malware_first_detected_at` and a website-level `malware_count`, and fixed HTML entities in website titles. **Outstanding:** confirm `vulnz-woo` and `/opt/scripts` do not still infer malware from `has_vulnerabilities` — the decoupling was shipped before that check was made

**Context for picking this up cold:**

- Reports are weekly, per user, sent by `sendWeeklyReports()` (`src/lib/reporting.js:284`) on a cron at `REPORTING_HOUR`, with the day chosen per user (`users.reporting_weekday`, CHAR(3) day codes). Recipient is `users.reporting_email` falling back to `users.username` — the same resolution the customer alert should use.
- Administrators get a report covering **all** websites; everyone else only their own. The same `isAdministrator ? null : userId` pattern runs through every query in `sendSummaryEmail()`.
- The M15 alert (`src/lib/malwareAlert.js`, `src/emails/malware-alert.hbs`) is the thing being extended, not a separate reference: its detection, dedup and failure handling all stay, and what changes is who receives it and how the customer-facing copy reads. `checkWebsiteForMalware()` already has the website row in hand, so the owner lookup is a single `user.findUserById(website.user_id)` — it is already doing exactly that call for the owner's name.
- Full background on the malware feature: [`15-known-malware.md`](15-known-malware.md).

---

## M11 — MariaDB Test Database Migration

**Status:** not started

Replace the in-memory SQLite test backend with a real local MariaDB test database. The current setup uses `tests/setup.js` to stand up in-memory SQLite and apply a MySQL→SQLite SQL translation shim. This was convenient for speed and zero-config, but it creates a real dev/prod inconsistency: tests exercise SQLite semantics, production runs MariaDB, and a class of bugs (BigInt handling, JSON functions, FULLTEXT indexes, `INSERT IGNORE` semantics, CHAR padding, boolean parsing) can pass in tests and fail in prod.

**Evidence this is real, collected since:** `component.search()` cannot be integration-tested at all because SQLite has no `MATCH … AGAINST` (M14, worked around with a mocked-db unit test). `WebsiteComponent.deleteByType()` uses MySQL multi-table `DELETE … FROM … JOIN` syntax that SQLite cannot parse, so the entire website update path had to be mocked to be testable (M15, worked around per-test). `component_changes` was simply absent from the test schema until M15. Array expansion for `IN (?)` is driver-specific and silently does nothing under SQLite (M15). Every one of these is a place where the tests do not exercise what production runs.

**Rationale for sequencing before M7:** M7 normalises ~40 env vars including booleans and enum-like strings. MariaDB and SQLite parse these differently, and the env-cleanup work benefits from running against accurate DB semantics.

### Tasks

- [ ] **M11.1** — Create `vulnz_t` database on local dev MariaDB. Grant the existing dev DB user access to it, or create a dedicated test user
- [ ] **M11.2** — Add `.env.test` template file (documented, not committed — add to `.gitignore` alongside `.env`). Update `jest.setup.js` (or equivalent) to load `.env.test` when `NODE_ENV=test`. Set `TZ=UTC` there at the same time — the suite currently runs in the host's local timezone, so the v1.32.1 UTC fix is not exercised (see the date/time item in the snag list)
- [ ] **M11.3** — Remove the MySQL→SQLite translation shim from `tests/setup.js`. Rip out the `better-sqlite3` dependency from `package.json`
- [ ] **M11.4** — Rewrite `createTestDatabase()` and `cleanupTestDatabase()` to use MariaDB. Swap the between-test reset strategy from DROP/CREATE (expensive on real MariaDB) to `TRUNCATE TABLE` with `SET FOREIGN_KEY_CHECKS=0` around it
- [ ] **M11.5** — Audit all tests for SQLite-specific assumptions: FULLTEXT search behaviour, JSON function differences, CHAR padding, NULL comparison, `INSERT IGNORE` vs `INSERT … ON DUPLICATE KEY`, case sensitivity. Fix any tests that were written against the wrong semantics — these are latent bugs
- [ ] **M11.6** — Un-mock what only had to be mocked because of SQLite: `component.search()` (`tests/api/malware.test.js`, `tests/api/components.test.js`), `WebsiteComponent.deleteByType()` (`tests/api/website-malware.test.js`, `tests/api/websites.test.js`). These are the concrete payoff for the migration
- [ ] **M11.7** — Verify all tests pass against real MariaDB. Document any tests where behaviour differed and required fixes
- [ ] **M11.8** — Update `dev-notes/06-testing-guide.md` with new setup instructions: how to create the test DB, how to configure `.env.test`, how tests isolate between files
- [ ] **M11.9** — Update `CLAUDE.md` and `AGENTS.md` to remove references to the SQLite shim and document the new MariaDB-required test setup
- [ ] **M11.10** — If CI is in use, update the CI config to provision a MariaDB service container before running tests
- [ ] **M11.11** — Update CHANGELOG with a developer-facing note about the test setup change, and mention in the README that running tests now requires a local MariaDB instance

---

## M7 — Environment Variable Normalization Cleanup

**Status:** not started

~30 env vars across 13 files bypass `src/lib/env.js` and use raw `process.env` access with inline `parseInt`/string comparison. Violates the project's no-direct-`process.env` rule. Risk: NaN bugs from misconfigured integers, boolean parsing failures (`'True'`/`'1'`/`'yes'` all silently fail), and no startup validation for critical vars.

Scope shrank after M10 removed the session-related vars. `src/lib/email.js` is the most visible remaining offender — it reads eight `SMTP_*` and `REPORTING_*` vars directly at module load.

- [ ] **M7.1** — Normalize integer env vars in `env.js`: `REPORTING_HOUR`, `REPORTING_BATCH_SIZE`, `WPORG_RESYNC_DAYS`, `WEBSITE_AUTO_DELETE_DAYS`, `API_LOG_RETENTION_DAYS`, `MAX_API_KEYS_PER_USER`, `HTTP_LISTEN_PORT`, `PASSWORD_MIN_*` (still used by `validatePassword()` for the CLI)
- [ ] **M7.2** — Normalize boolean env vars in `env.js`: `CORS_ENABLED`, `CORS_CREDENTIALS`, `WEBSITE_AUTO_DELETE_ENABLED`, `SMTP_IGNORE_TLS`
- [ ] **M7.3** — Normalize enum env vars in `env.js`: `SERVER_MODE`, `REFERENCE_UPDATE_METHOD`
- [ ] **M7.4** — Normalize string env vars in `env.js` with validation where appropriate: `BASE_URL`, `SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`, `DB_HOST`/`USER`/`PASSWORD`/`NAME`, `CORS_ORIGIN`, `VULNZ_NOTIFY_SECRET`, `GEOIP_DATABASE_PATH`, `REPORTING` text vars, `EXAMPLE_WP_COMPONENT_*`
- [ ] **M7.5** — Replace all raw `process.env` reads in `src/` with normalized values — `index.js`, `config/db.js`, `lib/email.js`, `lib/geoip.js`, `lib/passwordValidation.js`, `lib/referenceData.js`, `lib/reporting.js`, `middleware/notifyAuth.js`, `models/apiCallLog.js`, `models/emailLog.js`, `models/user.js`, `routes/config.js`
- [ ] **M7.6** — Update `.env.example` with any missing vars and add validation notes
- [ ] **M7.7** — Tests: ensure the suite still passes with normalized env vars, add `jest.setup.js` entries for any new required vars

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

## Recently Completed

Full task lists in [`archive/00-project-tracker-m9-m15-archive.md`](archive/00-project-tracker-m9-m15-archive.md).

| Milestone                               | Version | Shipped    | Summary                                                                                                                                                             |
| --------------------------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M15** — Malware Detection on Websites | v1.35.0 | 2026-08-13 | `GET /api/websites/malware` + immediate email alert on sync, deduplicated per (website, component). [Notes](15-known-malware.md#8-m15--detection-on-websites-v1350) |
| **M14** — Known Malware Flagging        | v1.34.0 | 2026-08-13 | Component-level `is_malware` covering every version; CLI-only writes; wordpress.org slug-squatting guard. [Notes](15-known-malware.md)                              |
| **M13** — Urgent Update Classification  | v1.33.0 | 2026-07-24 | `is_urgent` on the fleet manifest via LLM changelog classification. [Notes](14-urgent-updates.md)                                                                   |
| **M12** — Fast Update Triggers          | v1.32.0 | 2026-07-23 | Fleet version manifest, priority wporg sync lanes, WordPress core version sync. [Notes](12-fast-update-triggers.md)                                                 |
| **M10** — Web UI Decommission           | v1.31.0 | 2026-04-11 | CLI + API only; sessions, password reset and the UI build pipeline all removed.                                                                                     |
| **M9** — Bulk Releases Endpoint         | v1.30.0 | 2026-04-10 | `POST /api/releases/bulk` for vulnz-ingest.                                                                                                                         |

**Deferred out of completed milestones**, not yet scheduled:

- **M13:** tier-2 vulnerability-feed backfill (`patched_in` + severity via vulnz-ingest, to catch silently-patched releases); `urgent_since` for the multi-version-behind case; notification on urgent classification.
- **M14/M15:** `malware: [slug, …]` array on the fleet manifest for proactive host-side sweeps (no consumer today); per-site contact routing for the immediate alert, replacing the single `MALWARE_ALERT_EMAIL`.
- **M12:** theme support in the fast-update lane (child-theme filtering unresolved); weekly-report insecure-vs-outdated split; the 55 unfixable-bundled-plugin sites.

---

## Other Repositories

Work that belongs to VULNZ but does not live in this repo:

- **`/opt/scripts` (fleet, separate repo)** — teach `wordpress_is_auto_update_due()` to act on `is_urgent` from the M12/M13 manifest rather than on version drift alone, keeping the existing `wp-update.is-disabled` and `hw_block_updates` guards winning over an urgent trigger. Four real urgent entries are live in the manifest to test against. Also the eventual consumer for malware slugs.
- **`vulnz-woo` (WordPress plugin)** — the customer-facing admin UI. Should branch on `is_malware` rather than `has_vulnerabilities`, which M16.8 depends on.
- **`vulnz-ingest`** — feed aggregation, pushes to the bulk endpoints. Candidate home for premium plugin version scrapers (paused 2026-07-29; needs a milestone number when resumed — M14 was reassigned to known malware).
