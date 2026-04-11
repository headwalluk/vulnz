# VULNZ API — Archived Milestones (M1–M6)

Completed milestones from the structured milestone tracker (formerly `00-project-tracker.json`). Archived 2026-04-11 to keep the active tracker focused on in-flight work. Retained here for historical context.

---

## M1 — CLI Skeleton + User Management ✅

Core goal: allow an administrator account to be created on a clean install, and manage user accounts (add/delete/block). Replaces the `SETUP_MODE` env var approach which was a security risk.

- [x] **M1.1** — Create `bin/` directory and `bin/vulnz.js` scaffold using commander
- [x] **M1.2** — Implement `user:add <email> <password> [--admin]` command
- [x] **M1.3** — Implement `user:list` command (table output, `--json` flag)
- [x] **M1.4** — Implement `user:delete <email>` command
- [x] **M1.5** — Implement `user:block <email>` and `user:unblock <email>` commands
- [x] **M1.6** — Implement `user:reset-password <email> <new-password>` command
- [x] **M1.7** — Remove `SETUP_MODE` auto-admin creation code from `src/` once CLI is proven
- [x] **M1.8** — Write tests for CLI commands
- [x] **M1.9** — Update README with CLI usage documentation

---

## M2 — API Key Management ✅

Allow CLI management of API keys without needing to log into the web admin.

- [x] **M2.1** — Implement `key:list <email>` command
- [x] **M2.2** — Implement `key:generate <email>` command
- [x] **M2.3** — Implement `key:revoke <key>` command
- [x] **M2.4** — Write tests and update documentation

---

## M3 — Feed & Component Inspection Tools ✅

Useful diagnostic commands for checking database state and ingestion health.

- [x] **M3.1** — Implement `feed:status` — show last Wordfence ingestion timestamp
- [x] **M3.2** — Implement `component:find <slug>` — quick DB lookup
- [x] **M3.3** — Implement `release:list <slug>` — list known releases for a component
- [x] **M3.4** — Write tests and update documentation

---

## M4 — npm Package Support ✅

Add npm as a first-class ecosystem alongside WordPress. This included DB schema changes, API updates (backward-compatible), a vulnerability feed processor, and a `vulnz-sensor` npm package for Node.js projects. See `dev-notes/09-multi-platform-support.md` for architecture decisions.

- [x] **M4.1** — DB migration: create `ecosystems` table, add `ecosystem_id` to `component_types` and `websites`, add `platform_metadata` to `websites`, seed wordpress/npm ecosystems, add npm-package component type
- [x] **M4.2** — Add `GET /api/ecosystems` endpoint and Ecosystem model
- [x] **M4.3** — Update `PUT /api/websites` to accept npm-package components (generic `components` array with `type` field, backward-compatible with existing `wordpress-plugins`/`wordpress-themes` keys)
- [x] **M4.4** — Update website model: store `ecosystem_id` and `platform_metadata` when creating/updating websites
- [x] **M4.5** — Create `scripts/process-npm-vulnerabilities.sh` — batch-query OSV.dev for tracked npm packages and insert/update vulnerability records
- [x] **M4.6** — Create `vulnz-sensor` npm package (`packages/vulnz-sensor/`) — reads `package.json`, posts dependencies to vulnz-api via `PUT /api/websites/:domain`
- [x] **M4.7** — Write tests for ecosystem API: `GET /api/ecosystems`, npm-package components in `PUT /api/websites`, backward-compat with old `wordpress-plugins`/`themes` keys
- [x] **M4.8** — Update documentation: README, CHANGELOG, API docs

---

## M5 — WooCommerce Subscription Integration ✅

Server-to-server notification system linking WordPress/WooCommerce sites to the API. WP sends fat-ping notifications; API pulls data and manages user accounts. Supports multiple source sites with per-site credentials.

- [x] **M5.1** — DB migration: `notification_sites`, `notification_queue`, `user_subscriptions` tables + `notifications.processing_mode` app setting
- [x] **M5.2** — Models: `notificationSite`, `notificationQueue`, `userSubscription` with multi-source precedence logic
- [x] **M5.3** — `POST /api/notifications/subscription-changed` endpoint with `X-Vulnz-Secret` auth, rate limiting, IP allowlist, queue/immediate mode
- [x] **M5.4** — Notification processor: pull from WP REST API, upsert user/subscription, auto-provision API keys, push keys back to WP
- [x] **M5.5** — CLI commands: `site:add`/`list`/`remove`, `queue:status`/`process`, `setting:get`/`set`/`list`
- [x] **M5.6** — Cron jobs: queue processing every 2 minutes, queue purge weekly
- [x] **M5.7** — Security: timing-safe secret comparison, rate limiting, Swagger security schemes, CORS header
- [x] **M5.8** — Tests: 18 notification API tests covering auth, validation, queue/immediate modes, idempotency, API key provisioning
- [x] **M5.9** — Documentation: `docs/cli.md`, README refactor, changelog, updated test counts

---

## M6 — Multi-Ecosystem Search ✅

Enhance the component search API and public frontend to support filtering by ecosystem/component type, and visually distinguish results across ecosystems. Driven by vulnz.net frontend integration and upcoming npm package data.

- [x] **M6.1** — Backend: add optional `type` and `ecosystem` query params to `GET /api/components/search` — filter across all 4 UNION branches and the data-fetch query
- [x] **M6.2** — Backend: enrich search response with ecosystem metadata — JOIN `component_types` → `ecosystems` to include `ecosystem_slug` and `ecosystem_name` per result
- [x] **M6.3** — Frontend: display ecosystem/type badges on search results (e.g. "WordPress Plugin", "npm Package") so duplicate slugs across ecosystems are visually distinct
- [x] **M6.4** — Frontend: add ecosystem filter dropdown/pills to the public search UI, wired to the new query params
- [x] **M6.5** — Swagger: update `/api/components/search` docs with new query params and enriched response schema
- [x] **M6.6** — Tests: add search tests for type/ecosystem filtering, mixed-ecosystem results, and backward compatibility (no filter = all ecosystems)
