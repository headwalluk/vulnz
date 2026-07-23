# Fast Update Triggers

**Status:** implemented — M12, v1.32.0 (2026-07-23)
**Author:** Claude Code (with Paul)
**Created:** 2026-07-23

VULNZ gains the ability to answer one question, cheaply and often:

> *Which components should every host on the fleet update **right now**, rather than waiting for tonight's run?*

The answer is exposed as a small, cacheable GET route. Each fleet host pulls it during its hourly ISP Tick, caches it locally, and uses it to short-circuit `wordpress_is_auto_update_due()`.

§1–§4 and §7 are the original requirements/analysis and remain accurate. §0 records what actually shipped; where the as-built design diverges from §5, §0 wins and the divergence is flagged inline.

---

## 0. As built (v1.32.0)

**Manifest, not danger-list.** The route returns *latest known versions*; the fleet host does the comparison. This is the single biggest change from §5. It deletes the server-side "is this site behind" join (§5.1), `first_seen_at` / trigger-expiry (§5.4, §8.5), and the per-trigger email (§5.5) — and it structurally cannot trigger the self-inflicted DoS §5.1 warns about, because a host only ever acts on its own real drift and the condition clears the instant it updates.

**Route:** `GET /api/wordpress/latest-versions` (not `/api/update-triggers` — ecosystem-namespaced so `/api/npm/…` fits later). `apiAuth`, `Cache-Control: public, max-age=300`, Express auto-ETag. Served live from the indexed `components` rows, not a precomputed snapshot. Payload: `wordpress_core.latest_version`, `plugins[] {slug, latest_version, checked_at}`, `blind_spots[]`. `generated_at` reflects when the underlying data last changed, so body + ETag are stable until data moves.

**Priority lane** (`sync_priority` = `high`|`low`, §4.2). Slug-keyed lookup table `sync_priorities` + `components.sync_priority_slug` (FK). High lane re-syncs the watchlist hourly; the low lane keeps the existing background rotation, minus the high rows.

**Version capture** (§4.1 fixed). The wporg sync now stores `data.version` in `components.latest_version` (+ `latest_version_at`) and upserts a release row. `components.wporg_available` (NULL/1/0) distinguishes "on wordpress.org" from "404" — the old sync collapsed both, hiding blind spots.

**Watchlist** (`src/lib/watchlist.js`). `static (app setting wporg.watchlist_static) ∪ top-N watchable by production install count (all tenants, is_dev = 0)`. Rank → skip unwatchable → keep going until N watchable found (Paul's rule). Premium/missing slugs → `blind_spots` (persisted to `wporg.watchlist_blind_spots`), never silent, and kept out of the wporg lane. `WPORG_WATCHLIST_SIZE` default 20.

**WordPress core** (§5.3, done as designed). `src/lib/wpcore.js` syncs `api.wordpress.org/core/stable-check/1.0/` hourly → `wordpress.current_version` (single `latest`) + `wordpress.safe_versions` (the ~24 non-insecure entries). `classifyWordPressVersion()` → `latest | outdated | insecure | current`. Fails safe: a bad response never overwrites good settings.
  - **Root-cause fix:** `data/reference.json` hardcoded `wordpress.current_version = 6.9` and reapplied it on every startup. Removed; the sync now owns the value, plus a one-shot sync at boot.
  - Reporting is a *data-only* beneficiary this build: a correct `current_version` means a site on 6.9.5 now flags as behind 7.0.2. The weekly email's insecure-vs-outdated split (using `classify()`) is **deferred**.

**Schedule** (all instance-0 / `CRON_ENABLE` guarded): `0 * * * *` high lane, `5 * * * *` core, `0 */6 * * *` watchlist rebuild.

**CLI:** `wporg:sync-core`, `wporg:sync-high`, `wporg:watchlist`, `wporg:watchlist:rebuild`.

**Still out of scope:** themes (child-theme filtering unresolved), the per-trigger email, and the 55 unfixable-bundled-plugin sites (§9).

---

## 1. The Problem

Fleet sites are auto-updated overnight (backup, then update, then housekeeping). That works — see §7 for evidence that drift is genuinely low.

The weakness is *latency*, not correctness. The observed gap between a WordPress or plugin security release being published and the first exploitation attempts can be **as little as 6 hours**. A critical WooCommerce release published at 05:00 local leaves dozens of sites exposed for up to 24 hours before the next overnight window.

**Goal: reduce worst-case exposure from ~24 hours to ~1 hour.**

Non-goal: replacing the overnight run. It stays exactly as it is. This adds a second, faster trigger alongside it.

---

## 2. Recommendation — build it into VULNZ

Recommended over a standalone cron tool on `sentinel`. The reasoning, heaviest first:

1. **Every input already lives here.** Installed inventory per site, the host each site sits on (`meta.Server`), release history per component, and the Wordfence vulnerability join. A standalone tool would have to replicate the inventory cache and keep it fresh.
2. **The polling loop already exists.** `syncNextPlugin()` in `src/lib/wporg.js` already walks the component table and queries wordpress.org. It is too slow and throws away the one field we need (§4), but the machinery, error handling, and User-Agent discipline are all in place. Extending it is a much smaller change than building a second poller.
3. **Email already exists.** `src/lib/email.js`, `emailLog`, `notificationQueue`, and `src/lib/reporting.js` already send scheduled mail. A standalone tool would need a new mail path (and `sentinel` has no `msmtp` relay configured — that's set up on `hhw7`).
4. **Auth and distribution are solved.** Every fleet host already holds a VULNZ API key and already talks to this API. No new secret to distribute, no new endpoint to firewall.
5. **Commercial plugin coverage only exists here.** wordpress.org cannot see `elementor-pro`, `gp-premium`, `astra-addon`, `revslider` — but VULNZ holds Wordfence-sourced release records for them. A wordpress.org-only tool is structurally blind to exactly the plugins with the worst track records.
6. **No new maintenance debt** — the stated constraint. No new host role, no new cron owner, no new state store.
7. It is plausibly a **product feature**, not just internal tooling. "Tell me what to patch right now" is the sharp end of what VULNZ is for.

### The honest cost

This puts VULNZ on the critical security path for the fleet. Mitigated by making the fleet side **fail-safe**: hosts cache the last good response, and if the fetch fails they fall back to existing overnight behaviour. Never fail-open (update everything), never fail-closed (never update). A VULNZ outage degrades the fleet to today's status quo, which is acceptable.

Standalone would only win if we wanted zero changes to a production API, or needed this working before VULNZ could next be deployed.

---

## 3. What already exists (verified 2026-07-23)

| Capability | Where | State |
|---|---|---|
| Per-site component inventory | `GET /api/websites` | 308 sites (245 prod, 63 dev); 242 of 245 prod re-checked today |
| Host mapping for dispatch | `websites[].meta.Server` | Populated; 7 `hhw*` hosts plus `nexus`, `sentinel` |
| Release history per component | `GET /api/components/:type/:slug` → `releases[]` | 566 releases for `woocommerce` |
| Vulnerability join | `releases[].has_vulnerabilities`, `websites[].vulnerability_count` | Live — 55 prod sites currently flagged |
| Commercial plugin releases | Wordfence feed via `vulnz-ingest` | `elementor-pro` 41 releases, `revslider` 36 |
| wordpress.org metadata sync | `syncNextPlugin()`, `src/lib/wporg.js:61` | Runs every minute (`src/index.js:270`) |
| Bulk release ingest | `POST /api/releases/bulk` | Working, round-trip tested (M9) |
| Scheduled email | `src/lib/email.js`, `src/lib/reporting.js` | Weekly reports already sending |
| Theme support in schema | component type `wordpress-theme` | **Type exists, zero rows populated** |

---

## 4. The gap — precisely

Four things are missing. All are small.

### 4.1 The wporg sync discards the version

`syncNextPlugin()` (`src/lib/wporg.js:61`) fetches `/plugins/info/1.0/{slug}.json` and persists `title`, `url`, `description`, `added`, `last_updated`, `requires_php`, `tested`. The response also carries `version` — the current release — and it is **not captured**.

That single field is the entire basis of "is there something newer than what my sites are running". It should be upserted as a release row for the component.

### 4.2 The sync rotation is far too slow

```sql
SELECT * FROM components WHERE component_type_slug = 'wordpress-plugin'
  AND synced_from_wporg != 1 ORDER BY synced_from_wporg_at ASC LIMIT ?
```

- Batch size `WPORG_UPDATE_BATCH_SIZE` defaults to **1**, once per minute → 1,440 components/day.
- `WPORG_RESYNC_DAYS` defaults to **7**, so each component is re-checked roughly weekly.

A weekly round-robin cannot serve a 6-hour threat window. What's needed is a **priority lane**: watchlist components re-synced hourly, everything else continuing on the existing fair rotation.

Do not simply raise the batch size — that hammers a free shared API for 1,100+ slugs when only ~30 matter.

### 4.3 No route exposing the danger list

Nothing to pull. §5.4 proposes it.

### 4.4 The `vulnz-ingest` wordpress.org feed cannot substitute

`src/feeds/wordpress-org.js` uses `request[browse]=updated`, `per_page=250`, and `WPORG_RELEASES_PAGES` defaults to **1** — a 250-plugin window over a ~60,000-plugin repository. Excellent for opportunistic harvesting; useless as a guarantee that a *specific* watched slug was seen. The priority lane in §4.2 must be targeted, not a firehose.

---

## 5. Design

### 5.1 The trigger rule — *fix available*, not *is vulnerable*

**This is the most important decision in the document. Getting it wrong bricks the fleet.**

A component belongs on the danger list when:

```
installed_version < latest_known_version
  AND (component is on the watchlist  OR  installed_version has known vulnerabilities)
```

The `installed_version < latest_known_version` clause is **not optional**.

Reason: 55 production sites currently run components with known vulnerabilities, and they are overwhelmingly **bundled premium-theme plugins with no update channel at all** — `js_composer` (13 sites across two versions), `revslider` (3 versions), `LayerSlider`, `fusion-builder`, `salient-core`, `dt-the7-core`, `uncode-core`, `bridge-core`, `mikado-core`. Nothing will ever ship these an update automatically.

If the trigger were merely "site has a vulnerable component", those 55 sites would become eligible for an immediate update **every hour, forever**, and the condition would never clear. That is a self-inflicted denial of service on the fleet's own update machinery.

Corollary: the fleet side must also record *which* trigger it actioned, so that an update which runs but does not resolve the condition (vendor pulled the release, licence expired, patch failed) does not re-fire on the next tick. Trigger, action, and outcome must be distinguishable.

### 5.2 Watchlist construction

```
watchlist = top_N_by_prod_install_count  ∪  static_always_check_list
```

- **Derived half** — `GROUP BY` over website components, production sites only, refreshed a few times a day. N ≈ 30 is a sensible start (§7 shows what that covers).
- **Static half** — hand-maintained. Must include the big-hitters regardless of install count: `woocommerce`, `elementor`, `elementor-pro`, `advanced-custom-fields`, plus the `hello-elementor` theme.
- Deduplicate, then tag each entry.

**Every entry must carry a `watchable` flag**, because five of the current top 30 do not exist on wordpress.org:

| slug | prod sites | on wordpress.org |
|---|---|---|
| `spam-shield` | 245 | no (ours) |
| `elementor-pro` | 64 | no |
| `gp-premium` | 36 | no |
| `astra-addon` | 32 | no |
| `quick-2fa` | 31 | no |
| `revslider` | 29 | no |

An unwatchable component must be **reported as a blind spot, never rendered as silence**. A slug that returns nothing from wordpress.org looks identical to a slug that is perfectly up to date, and `revslider` and `elementor-pro` are precisely the ones where that false comfort is dangerous. For these, Wordfence-sourced release records are the only signal — and since Wordfence generally only publishes releases connected to vulnerabilities, absence of a record does *not* mean absence of a release.

### 5.3 WordPress core

There is **no `wordpress-core` component type** — only `npm-package`, `wordpress-plugin`, `wordpress-theme`. Core version lives on the website record as `wordpress_version`.

Recommended v1: keep core out of the component model and carry it as a **dedicated field** in the danger-list response, populated from the wordpress.org core version-check API. Core is a single global "latest" value; per-site inventory already exists on the website record. Adding a component type for one row is more schema than the problem deserves.

Revisit if core ever needs per-release vulnerability association.

### 5.4 The route

Component-level, not site-level. The host already knows its own installed plugins — and its inventory is fresher than ours, because it *is* the source. Sending a component list rather than a site list keeps the payload tiny, the cache trivially reusable across all sites on the host, and the API stateless with respect to which sites are due.

```
GET /api/update-triggers
```

Sketch:

```json
{
  "generated_at": "2026-07-23T14:00:00.000Z",
  "wordpress_core": { "latest_version": "7.0.2" },
  "triggers": [
    {
      "component_type_slug": "wordpress-plugin",
      "component_slug": "woocommerce",
      "latest_version": "10.9.5",
      "reason": "watchlist_release",
      "first_seen_at": "2026-07-23T13:04:00.000Z",
      "watchable": true
    },
    {
      "component_type_slug": "wordpress-plugin",
      "component_slug": "revslider",
      "latest_version": "6.7.38",
      "reason": "vulnerability_fix_available",
      "first_seen_at": "2026-07-22T09:00:00.000Z",
      "watchable": false
    }
  ],
  "blind_spots": ["spam-shield", "gp-premium", "astra-addon", "quick-2fa"]
}
```

Requirements:
- Authenticated with the existing fleet API key; read-only.
- Cheap and cacheable — this is hit by every host every hour. Compute on a schedule and serve a stored result; do not recompute per request.
- Include `first_seen_at` so hosts can distinguish a new trigger from one they have already actioned.
- Include `blind_spots` explicitly (§5.2).
- New config via `src/lib/env.js`, not raw `process.env` — see M7 in `00-project-tracker.md`.

### 5.5 Email

Reuse the existing notification/email path. One email per newly-detected trigger, sent immediately, **not batched and not suppressed overnight**.

Because state persists, a 03:00 release is still in the inbox at 07:00 — no digest logic required. Do not add quiet hours; the entire point is that the overnight window is when exposure is worst.

---

## 6. Fleet-side integration (different repo — `/opt/scripts`, noted for context)

Not part of this work, but the consumer shape constrains the API design:

- ISP Tick pulls `GET /api/update-triggers` hourly, writes a local cache, and falls back to the last good cache on failure.
- `wordpress_is_auto_update_due()` (`modules/wordpress.sh:5872`) gains an additional path returning true when the site's WP core is behind, or any installed plugin — **active or inactive** — is behind a danger-list entry.
- Existing guards must still win: the per-site `is-disabled` flag in `wp-update.is-disabled`, and the `hw_block_updates` holdback. An urgent trigger must not walk over a deliberate hold. Elementor 4.2.0 is the live example — a patched version is deliberately held, and a naive "newer version exists, go" would undo it.
- Dev sites: 63 of 308 are `is_dev`. Commercial plugins freeze on dev clones because licences bind to the production domain, so dev sites will show as permanently behind. They must not generate perpetual triggers.

### On wpatcher

Paul's position, recorded: **a site brought up to date and failing on page load is preferable to a site left running and vulnerable.** Most patches suppress telemetry and log noise; where they do fix critical holes, the update is still the right call. So an urgent update proceeds even if it drops a wpatch.

The follow-on requirement — *alert when a patched plugin is updated and the new version is no longer patched* — is real and acknowledged, but explicitly **out of scope here** and belongs on the `/opt/scripts` side.

---

## 7. Evidence (measured 2026-07-23)

Drift for the top 30 plugins by production install count, against wordpress.org:

- **~1,500 installs, 8 sites behind.** The overnight updater is working. This project targets the *window*, not a drift problem.
- Sites: 308 total — 245 production, 63 dev.
- Inventory freshness: 242 of 245 production sites re-checked today; 3 stale (2026-07-10, 07-15, 07-18) — worth a look independently.
- WP core: 243 sites on 7.0.2, 2 on 7.0.1.
- **Zero themes tracked across all 308 sites.** The `wordpress-theme` component type exists and the pipeline supports it — the fleet-side reporter simply does not send themes. Smaller fix than it first appears, but it does mean `hello-elementor` cannot be watched until it is fixed.

Top 10 by production install count:

| plugin | sites | | plugin | sites |
|---|---|---|---|---|
| `spam-shield` | 245 | | `wp-sweep` | 110 |
| `wordpress-seo` | 190 | | `advanced-custom-fields` | 105 |
| `autoptimize` | 163 | | `webp-converter-for-media` | 80 |
| `contact-form-7` | 141 | | `elementor` | 79 |
| `mini-wp-gdpr` | 117 | | `duplicate-post` | 75 |

1,106 distinct plugin slugs across production.

---

## 8. Open questions

1. **Where does the priority sync run** — inside the API process (extending `syncNextPlugin`) or as a new `vulnz-ingest` command? Recommendation: inside the API, because the watchlist derives from a DB query the API already owns, and `vulnz-ingest`'s schedule is coarse. Needs confirming against how the API is deployed (PM2 instance pinning already guards cron duplication — `src/index.js:249`).
2. **Watchlist size `N`** — 30 proposed. Cheap to raise; each entry costs one wordpress.org request per hour.
3. **Poll frequency** — hourly proposed. Half-hourly doubles load on a free shared API for a median 15-minute gain. Recommend starting hourly and measuring.
4. **Should dev sites contribute to the top-N calculation?** Recommendation: no — production install count is what represents real exposure.
5. **Trigger expiry** — how long does an entry stay on the list after the fix ships? Proposal: drop it once no monitored production site is behind, so the list self-clears.

---

## 9. Out of scope

- The wpatcher "patch no longer applied after update" alert (§6) — `/opt/scripts` side, separate work.
- Theme reporting from the fleet — prerequisite for watching `hello-elementor`, but a fleet-side reporter change.
- **The 55 sites carrying vulnerable bundled theme plugins.** No update-speed improvement touches this, because those components have no automated update channel at all. It is arguably the larger standing exposure and deserves its own project.
