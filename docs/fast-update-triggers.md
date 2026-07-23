# Fast Update Triggers

The **fast update trigger** system lets a fleet of WordPress hosts patch a critical core or plugin release within the hour, instead of waiting for the nightly update cycle.

VULNZ publishes a small, cacheable manifest of the **latest known versions** of WordPress core and a watchlist of high-value plugins. Each fleet host polls it (typically hourly), compares it against its own installed inventory, and triggers an immediate update for anything that is behind.

> **Principle: the manifest is information, not instruction.** VULNZ says *"the current WooCommerce is 10.9.5"* — it never says *"update site X"*. The host owns the comparison and every local guard (deliberate holds, disabled sites, dev clones). A VULNZ outage degrades the fleet to its normal overnight cycle; it never forces or blocks an update.

- [The endpoint](#the-endpoint)
- [How the watchlist is built](#how-the-watchlist-is-built)
- [Administering the "always monitor" list](#administering-the-always-monitor-list)
- [WordPress core version](#wordpress-core-version)
- [Blind spots (premium plugins)](#blind-spots-premium-plugins)
- [Operations: sync lanes and schedule](#operations-sync-lanes-and-schedule)
- [CLI reference](#cli-reference)
- [Configuration](#configuration)

---

## The endpoint

```
GET /api/wordpress/latest-versions
```

Authenticated with any valid API key via the `X-API-Key` header (no admin role required — it is read-only). Ecosystem-namespaced under `/api/wordpress` so other ecosystems (e.g. npm) can add their own manifest later.

```bash
curl -s -H "X-API-Key: ${VULNZ_API_KEY}" \
  https://vulnz.net/api/wordpress/latest-versions
```

### Response

```json
{
  "generated_at": "2026-07-23T14:00:00.000Z",
  "wordpress_core": { "latest_version": "7.0.2" },
  "plugins": [
    { "slug": "woocommerce", "latest_version": "10.9.5", "checked_at": "2026-07-23T13:04:00.000Z" },
    { "slug": "elementor",   "latest_version": "4.2.0",  "checked_at": "2026-07-23T13:04:00.000Z" }
  ],
  "blind_spots": ["elementor-pro", "revslider"]
}
```

| Field | Meaning |
|---|---|
| `generated_at` | When the underlying data last **changed** (freshest plugin `checked_at`, or the core version's update time) — **not** request time. Identical data returns an identical body, so the response and its ETag are stable between polls. |
| `wordpress_core.latest_version` | Current stable WordPress core version, from wordpress.org (see [WordPress core version](#wordpress-core-version)). May be `null` before the first sync. |
| `plugins[]` | One entry per **watchable, high-priority** plugin that has a known latest version. `checked_at` is when VULNZ last confirmed that version against wordpress.org. Sorted by slug. |
| `blind_spots[]` | Watchlist slugs that **cannot** be tracked via wordpress.org (premium or not-yet-known). Listed explicitly so a host never mistakes "we can't see it" for "it's up to date". |

### Caching

The response carries `Cache-Control: public, max-age=300` and an ETag. Because `generated_at` is data-derived, a conditional request (`If-None-Match`) returns `304 Not Modified` until something actually changes. A host polling hourly is inexpensive — ten hosts is ~240 requests/day.

**Fleet-side recommendation:** write the last good response to a local cache and fall back to it on any fetch failure. Never fail-open (update everything) or fail-closed (never update) — fall back to normal overnight behaviour.

---

## How the watchlist is built

The set of plugins in `plugins[]` is the **high-priority watchlist**, rebuilt every 6 hours (and on demand). It is the union of two halves:

```
watchlist = static "always monitor" list   ∪   top-N watchable plugins by production install count
```

- **Static half** — a hand-maintained list of slugs that must always be watched regardless of how many sites run them. This is what you administer (below).
- **Derived half** — the most-installed plugins across **all** production sites in the database (dev sites excluded). Controlled by `WPORG_WATCHLIST_SIZE` (default **20**).

The derived half targets *watchable* plugins: the builder walks the install-count ranking and **skips** any plugin that isn't on wordpress.org, continuing until it has found `WPORG_WATCHLIST_SIZE` watchable ones. Unwatchable plugins it encounters become **blind spots** rather than filling a slot. So the high lane usually contains roughly `WPORG_WATCHLIST_SIZE` derived plugins **plus** the static extras.

Only watchable plugins are placed in the wordpress.org sync lane — a premium plugin would only ever return 404 there, so it is reported as a blind spot instead.

---

## Administering the "always monitor" list

The static list is a single app setting:

| | |
|---|---|
| **Key** | `wporg.watchlist_static` |
| **Format** | comma-separated plugin slugs (lower-cased; whitespace and blanks ignored) |
| **Default** | `woocommerce,elementor,advanced-custom-fields,contact-form-7,wordpress-seo,akismet` |
| **Category** | `sync` |

A "slug" is the wordpress.org plugin directory slug — the last path segment of `https://wordpress.org/plugins/<slug>/`. For example WooCommerce is `woocommerce`, Yoast SEO is `wordpress-seo`.

### View the current list

```bash
vulnz setting:get wporg.watchlist_static
```

### Change the list — CLI

```bash
vulnz setting:set wporg.watchlist_static \
  "woocommerce,elementor,advanced-custom-fields,contact-form-7,wordpress-seo,akismet,wordfence" \
  --category sync
```

> **Pass `--category sync`.** Writing the setting overwrites its category, and omitting the flag drops it out of the `sync` group in `setting:list`. It does not affect the watchlist itself (only the value is read), but keeps the settings list tidy.

### Change the list — API (admin key)

```bash
curl -X PUT https://vulnz.net/api/settings/wporg.watchlist_static \
  -H "X-API-Key: ${VULNZ_ADMIN_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
        "value": "woocommerce,elementor,advanced-custom-fields,contact-form-7,wordpress-seo,akismet,wordfence",
        "type": "string",
        "category": "sync"
      }'
```

`PUT /api/settings/:key` requires an **administrator** API key. `GET /api/settings/:key` works with any key.

### Apply the change

Editing the setting does not take effect until the watchlist is rebuilt. Either wait for the 6-hourly rebuild, or apply it immediately:

```bash
vulnz wporg:watchlist:rebuild
```

A newly added slug that exists on wordpress.org is promoted to the high lane and its latest version is fetched during the rebuild. A slug that isn't on wordpress.org (or doesn't exist) is reported as a blind spot.

### Verify

```bash
vulnz wporg:watchlist
```

```
WordPress core latest: 7.0.2
High-priority plugins (7):
  advanced-custom-fields           6.8.6
  akismet                          5.7
  contact-form-7                   6.1.6
  elementor                        4.2.0
  woocommerce                      10.9.5
  wordfence                        8.1.0
  wordpress-seo                    28.1
Blind spots (0): none
```

---

## WordPress core version

The core version in the manifest comes from wordpress.org's `core/stable-check/1.0/` API, synced hourly (and once at startup). It is stored in the `wordpress.current_version` app setting.

> This setting is **owned by the sync** — do not set it by hand. (Historically it was hardcoded in reference data and went stale; that is fixed.) Force a refresh with `vulnz wporg:sync-core`.

VULNZ also caches the classification of every non-vulnerable core version in `wordpress.safe_versions`, which distinguishes three states used by reporting:

- **latest** — the current release (e.g. `7.0.2`).
- **outdated** — the final patch of an older but still-maintained branch (e.g. `6.9.5`). Superseded, but **not** vulnerable.
- **insecure** — any earlier patch (e.g. `7.0.1`, `6.9.4`). Known-vulnerable.

For the fast-update manifest this distinction doesn't matter — a host behind `latest` updates regardless. It exists so weekly reports can flag a site on `6.9.5` as out-of-date without calling it vulnerable.

---

## Blind spots (premium plugins)

Premium plugins (Elementor Pro, GP Premium, Revolution Slider, etc.) are **not** distributed through wordpress.org, so their latest version cannot be checked there. If such a plugin is on the watchlist — either because it's popular or because you added it to the static list — it appears in `blind_spots[]` instead of `plugins[]`.

This is deliberate: a slug that returns nothing from wordpress.org looks identical to a slug that is perfectly current, and the premium plugins are exactly the ones where that false comfort is dangerous. Surfacing them as blind spots keeps them visible.

Release data for premium plugins comes from the Wordfence feed (via `vulnz-ingest`) instead. Watching them for the fast-update path needs different mechanics and is out of scope for this feature.

---

## Operations: sync lanes and schedule

Plugin metadata is synced from wordpress.org in two lanes:

- **High-priority lane** — the watchlist, re-synced **hourly** so a fresh release is picked up within the hour.
- **Low-priority lane** — every other plugin, on a slow background rotation (the pre-existing behaviour), minus the high-priority plugins.

Scheduled jobs (all run only on the primary instance, when `CRON_ENABLE=true`):

| Schedule | Job |
|---|---|
| `0 * * * *` (hourly) | Sync high-priority plugins from wordpress.org |
| `5 * * * *` (hourly) | Sync WordPress core version |
| `0 */6 * * *` (every 6h) | Rebuild the watchlist |
| startup | One-shot core version sync |

---

## CLI reference

| Command | Purpose |
|---|---|
| `vulnz wporg:watchlist` | Show the current high lane, latest versions, and blind spots. `--json` for machine output. |
| `vulnz wporg:watchlist:rebuild` | Rebuild the watchlist now (static ∪ top-N). Use after editing the static list. |
| `vulnz wporg:sync-high` | Sync every watchlist plugin from wordpress.org now. |
| `vulnz wporg:sync-core` | Refresh the WordPress core version now. |
| `vulnz setting:get wporg.watchlist_static` | View the static "always monitor" list. |
| `vulnz setting:set wporg.watchlist_static "<slugs>" --category sync` | Edit the static list. |

See [CLI Reference](cli.md) for the full command set.

---

## Configuration

Environment variables (see [Configuration](configuration.md) for the full reference):

| Variable | Default | Purpose |
|---|---|---|
| `WPORG_WATCHLIST_SIZE` | `20` | Target number of **watchable** plugins in the derived half of the watchlist. The static list is unioned on top. |
| `WPORG_WATCHLIST_SCAN_LIMIT` | `100` | How far down the install-count ranking to scan when finding `WPORG_WATCHLIST_SIZE` watchable plugins (headroom past premium/blind-spot slugs). |
| `WPORG_HIGH_PRIORITY_DELAY_MS` | `250` | Pause between requests in the hourly high-priority lane, to stay gentle on the shared wordpress.org API. |

The static list itself lives in the database (`wporg.watchlist_static` app setting), not in the environment, so it can be changed at runtime without a redeploy.
