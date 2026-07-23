# Snag List

A running list of small defects, rough edges, and tech-debt items to address in a future update. Not full milestones — these are the "we should tidy this up" notes that would otherwise get lost. Promote an item to a proper milestone in [`00-project-tracker.md`](00-project-tracker.md) once it grows big enough to warrant one.

Each item: a short heading, when/where it was noticed, why it matters, and a proposed action. Move resolved items to the bottom under **Resolved** with the version that fixed them (or delete once the CHANGELOG covers it).

---

## Open

### Deprecate `data/reference.json` startup overwrite

**Noticed:** 2026-07-23 (during M12, v1.32.0)

**What it is:** On every startup, `updateFromReference()` reads `data/reference.json` and writes its `app_settings` values into the database (`REFERENCE_UPDATE_METHOD=file`, `REFERENCE_UPDATE_LOCATION=./data/reference.json`). It was intended as a way to distribute baseline configuration (version thresholds, etc.) to installations.

**Why it matters:**

- **It silently overwrites live settings on every boot.** M12 hit this directly: `reference.json` hardcoded `wordpress.current_version = "6.9"` and reapplied it on every startup, clobbering the value the new WordPress-core sync writes. We fixed the immediate problem by removing that one key from the file — but the mechanism itself is a footgun. Any setting listed in `reference.json` cannot be changed at runtime; the file wins on the next restart. That is surprising and undocumented.
- **It emits noise on every startup** — `⚠️ Unknown setting in reference data: unknown.test_setting` and `⚠️ Unknown setting in reference data: wordpress.invalid_version`. These look like leftover test fixtures in the file.
- **The distribution model is unclear.** The `.env.example` shows a commented `REFERENCE_UPDATE_LOCATION=https://vulnz.net/reference.json`, implying it can be fetched from a URL — but it's unclear whether that file is still maintained or where it should be hosted (this is a self-hosted product; a phone-home config source is questionable). The FQDN there is also stale (`vulnz.net` vs `api.vulnz.net`), but that becomes moot if the whole mechanism goes.

**Proposed action (to scope in a future milestone):**

1. Decide the intended role of reference data. Options: (a) drop it entirely and let migrations seed defaults + the CLI/API manage settings thereafter; (b) keep it as a *seed-only* mechanism that runs once on a fresh install and never overwrites existing values; (c) keep it but make it opt-in per key.
2. Remove the test-fixture entries (`unknown.test_setting`, `wordpress.invalid_version`) from `data/reference.json`, or move them into a test fixture file so production startup is quiet.
3. Ensure no setting owned by a live sync (e.g. `wordpress.current_version`, and now `wordpress.safe_versions`) can ever be listed in reference data — or better, make reference application never overwrite `is_system` settings that a sync maintains.
4. Update or remove the `.env.example` `REFERENCE_UPDATE_*` lines and the CHANGELOG-referenced `reference.json` URL accordingly.

**Related:** M12 fast update triggers — [`12-fast-update-triggers.md`](12-fast-update-triggers.md) §0 ("root-cause fix").

---

### Audit every date/time interaction in the app

**Noticed:** 2026-07-23 (v1.32.1, during M12 prod rollout)

**What it is:** The M12 manifest exposed a systemic timezone bug — the mariadb driver deserializes `DATETIME` columns using the **process** timezone, but the database stores everything in UTC (session `time_zone = +00:00`; WordPress.org times are GMT). On the BST prod host, every timestamp read as a JS `Date` and rendered/compared as UTC came back an hour early. v1.32.1 fixed the **root cause** by pinning the process to UTC (`process.env.TZ = 'UTC'` in `src/index.js` and `bin/vulnz.js`).

**Why it still matters (why the fix isn't the end of it):**

- **The fix corrected reads globally, but any code written to _compensate_ for the old wrong behaviour is now doubly wrong.** If someone previously added an offset, or picked `UTC_TIMESTAMP()` vs `NOW()` vs a JS cutoff to "make the numbers look right" against the buggy read path, that workaround now skews the other way. We need to look, not assume.
- **The bug was latent everywhere, not just in the manifest.** Every `DATETIME` the app renders or does math on was affected — it was simply less visible than `checked_at`. Each of those paths should be confirmed correct now, not presumed.
- **Tests don't exercise the fix.** Jest doesn't load the entry points, so the suite runs in the host's local timezone (BST), not UTC — and tests use SQLite, which handles dates differently from MariaDB. So a date bug can pass tests and only show in production. Consider setting `TZ=UTC` in `tests/jest.setup.js` for parity, and/or adding coverage against real MariaDB (ties into M11).

**Proposed action — walk every date/time touchpoint and confirm it's correct under UTC:**

1. **Storage / `CURRENT_TIMESTAMP` / `NOW()`** across all models (`created_at`, `updated_at`, `synced_from_wporg_at`, `latest_version_at`, log timestamps, etc.) — confirm each round-trips correctly.
2. **WordPress.org date parsing** — `parseWpOrgDateTime()` / `parseWpOrgDate()` in `src/lib/wporg.js` store GMT strings as `DATETIME`. Confirm `last_updated` / `added` now read back as the correct instant.
3. **Retention / purge crons** that compare dates — `apiCallLog`, `emailLog`, `securityEvent`, `fileSecurityIssue`, `componentChange`, `notificationQueue` purges, and `website.removeStaleWebsites`. Check the JS-vs-DB cutoff boundary is consistent under UTC (an off-by-an-hour boundary could purge slightly early/late).
4. **Reporting windows** — `src/lib/reporting.js` computes "past 7 days" `startDate`/`endDate` in JS and passes them to queries; verify the JS/DB boundary lines up. Check date rendering in the email templates (`src/emails/*.hbs`).
5. **Presentation / `.toISOString()` / formatting** — `feed:status` `lastSyncedAt`, `user:info` API-key `created` and subscription dates, the `toIso()` helper in `src/routes/wordpress.js`, and any other `new Date()` / date formatting for display.
6. **`node-cron` timing** — schedules now evaluate in UTC (v1.32.1 side effect). Confirm the daily/weekly jobs (log purges, weekly report send `0 11,23`) run at acceptable UTC times, or pin specific ones with the per-schedule `{ timezone: 'Europe/London' }` option if wall-clock timing matters.
7. **Test parity** — decide on `TZ=UTC` in `tests/jest.setup.js` and note MariaDB-vs-SQLite date differences (see M11).

**Related:** v1.32.1 timezone fix; [`12-fast-update-triggers.md`](12-fast-update-triggers.md); M11 (MariaDB test DB) in [`00-project-tracker.md`](00-project-tracker.md).
