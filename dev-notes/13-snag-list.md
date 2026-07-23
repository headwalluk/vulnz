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
