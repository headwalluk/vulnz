# Fleet Queries for an AI Agent

A task-oriented guide to asking VULNZ questions about the whole fleet. [`api-usage.md`](api-usage.md) is the endpoint-by-endpoint reference; this covers what to ask, how to combine filters, and — most importantly — the places where a literal reading of a correct response gives the wrong answer.

---

## Setup

Authenticate with `X-API-Key` on every request. Keep the key in the environment rather than in commands or files you share:

```bash
# VULNZ_API_KEY is set by the agent's own environment
https --ignore-stdin api.vulnz.net/api/websites "X-API-Key: ${VULNZ_API_KEY}"
```

**Scope comes from the account, not the key.** A key belonging to an `administrator` sees every website in the database; any other user sees only their own. There is no read-only tier — the same key that answers these questions can also delete users, websites and components, so treat it as a write-capable credential even when only reading. On the server, `bin/vulnz.js key:show <key>` prints a key's owner, roles and access.

All examples below assume an administrator key.

---

## The queries

### Find a site

```http
GET /api/websites?q=acme&summary=true
```

`q` is a case-insensitive substring match against the **domain or the title**, so a partial domain or a site's name both work. `summary=true` returns one compact row per site (`domain`, `title`, `url`, `user_id`, `username`, `is_dev`, `wordpress_version`, `php_version`, `versions_last_checked_at`, `vulnerability_count`, `malware_count`) without the embedded plugin and theme lists, about a twentieth of the payload. Use it for any "which site did you mean?" step, then fetch the one you want in full.

### Everything about one site

```http
# The site and its full plugin and theme inventory
GET /api/websites/{domain}

# Report data: the facts behind the weekly email, for this one site
GET /api/websites/{domain}/report?days=7
```

The domain is matched leniently but never fuzzily. A scheme, path, port, trailing dot and letter case are ignored, and if nothing matches exactly, the same host with `www.` added or removed is tried. A full URL must be URL-encoded. The returned `domain` is the stored one. Anything else is a `404`: search with `q` instead of guessing.

The report returns:

| Field                  | What it holds                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `website`              | identity, owner, versions, `versions_last_checked_at` and `days_since_versions_checked`                                                                                |
| `summary`              | one count per section below, plus `wordpress_outdated` / `php_outdated`                                                                                                |
| `software`             | WordPress against the current release and PHP against the configured minimum, each with `is_outdated`                                                                  |
| `components`           | `vulnerable`, `malware`, `withdrawn` (wordpress.org closed) and `behind_latest`, each entry with `version`, `latest_version`, `vulnerabilities` and the closure fields |
| `file_security_issues` | totals by severity and the worst files                                                                                                                                 |
| `security_events`      | events by type and top source countries, within the period                                                                                                             |
| `component_changes`    | components added, removed or changed on the site, within the period                                                                                                    |
| `plugins_to_monitor`   | unmaintained and newly published plugins on the site                                                                                                                   |

`days` (default 7, at most 90) sets the period for events and changes only; everything else is current state. The report counts every component type, npm packages included. That differs from `vulnerability_count` on the list endpoints, which covers WordPress plugins and themes only. `is_outdated`, `wordpress_outdated` and `php_outdated` are `null` when the installed version is unknown or cannot be compared, which is not the same as `false`.

### Which sites does a user own?

Two steps: find the user, then list their sites.

```http
# 1. Find the account
GET /api/users?q=acme
# → users[]: { id, username, reporting_email, roles, website_count, … }

# 2. List what they own
GET /api/websites?user_id=42&summary=true&limit=200
```

`q` matches the account email (`username`) or the `reporting_email`. Users have no name field, so a person's name only works if it appears in one of those addresses. `website_count` tells you whether step 2 needs paging. `/api/users` requires an administrator key.

### Which versions of a plugin are installed, and where?

```http
GET /api/components/wordpress-plugin/wpmudev-updates/installs
```

One entry per installed version, newest first (values illustrative):

```json
{
  "component": { "slug": "foobar", "latest_version": "2.1.0", "is_malware": false, "wporg_status": "available" },
  "site_count": 41,
  "version_count": 3,
  "versions": [
    {
      "version": "2.0.3",
      "is_latest": false,
      "has_vulnerabilities": true,
      "vulnerabilities": ["https://…"],
      "site_count": 2,
      "sites": [{ "domain": "…", "title": "…", "url": "…", "user_id": 2, "username": "…", "is_dev": false, "versions_last_checked_at": "…" }]
    }
  ]
}
```

`site_count` at the top counts distinct sites. A site that reports two releases of the same plugin, which happens mid-upgrade, appears under both versions but is counted once. `is_dev=false` leaves dev sites out. An unknown slug is a `404`, never an empty answer. No component read creates anything (since v1.44.0), so a mistyped slug leaves no trace in the catalogue. `latest_version` is only as good as its source; see `blind_spots` below for premium plugins.

### Which sites run a given plugin?

```http
# Any version
GET /api/websites?component_slug=foobar

# One specific release
GET /api/websites?component_slug=foobar&component_version=1.2.3

# Disambiguate a plugin from a theme sharing the slug
GET /api/websites?component_slug=foobar&component_type=wordpress-plugin

# Only sites whose installed foobar is a vulnerable release
GET /api/websites?component_slug=foobar&only_vulnerable=true
```

With `component_slug`, `only_vulnerable=true` means **that component's** installed release is vulnerable (since v1.47.0). Before that it meant "the site runs foobar, and something on it is vulnerable", which reads as the same question and is not. For a per-version breakdown, `/installs?vulnerable_only=true` is clearer still.

`total` is the site count. Each entry carries the site's full plugin and theme lists, so the matching version is in `wordpress-plugins[]` alongside everything else installed. To see the versions themselves, grouped, use the `/installs` route above instead.

### Which sites are worst affected?

```http
GET /api/websites?sort=vulnerabilities&limit=10
GET /api/websites?sort=malware&limit=10
```

`sort` accepts `newest` (default), `vulnerabilities`, `malware`. Ranking happens in the database across the whole matching set, so page 1 really is the worst affected. Ties break on the other count, then on recency, so paging is stable. An unrecognised value returns `400` rather than silently falling back.

### Which sites are behind on a plugin?

Two steps — the API does not compute drift for you.

```http
# 1. What is current?
GET /api/wordpress/latest-versions
# → { wordpress_core: { latest_version }, plugins: [ { slug, latest_version, is_urgent, summary, checked_at } ], blind_spots: [ … ] }

# 2. Who is not on it?
GET /api/components/wordpress-plugin/<slug>/installs
# compare each versions[].version against latest_version
```

`is_latest` is an exact string match against the component's recorded `latest_version`. `false` is not proof of "behind". When `latest_version` is `null`, every entry is `false` and there is nothing to compare against. A site can also report a release newer than a stale `latest_version`.

`is_urgent` marks releases classified as security fixes rather than routine updates, with a one-line `summary` of what was fixed — prioritise those. `blind_spots` lists watchlist slugs wordpress.org cannot report on (premium plugins like `elementor-pro`, `gp-premium`); their absence from `plugins[]` is a known gap, not a clean bill of health.

`latest-versions` covers the ~28-slug watchlist, not the whole catalogue. For anything outside it, read `latest_version` from the component itself:

```http
GET /api/components/wordpress-plugin/<slug>
```

### Which sites run malware?

```http
GET /api/websites/malware
```

Returns one entry per affected site with a `malware_components[]` array. An empty `websites` array is the healthy answer. Computed live, so a newly flagged component appears immediately for every site already carrying it.

### Which sites run a plugin wordpress.org has withdrawn?

One call:

```http
GET /api/websites?component_wporg_status=closed
```

Every site carrying any withdrawn component, without needing to know a single slug in advance. Composes with the rest — `&only_vulnerable=true`, `&sort=vulnerabilities`, `&component_type=wordpress-plugin`. Here, with no `component_slug`, `only_vulnerable` means anything on the site is vulnerable, not necessarily the withdrawn plugin.

To enumerate the withdrawn components themselves, rather than the sites:

```http
GET /api/components?wporg_status=closed&limit=200
GET /api/components?wporg_status=closed&wporg_closure_reason=security-issue
```

Each result carries `wporg_closure_reason` and `wporg_closure_is_security_concern`. And for one named component:

```http
GET /api/components/wordpress-plugin/<slug>
# → wporg_status, wporg_closure_reason, wporg_closure_is_security_concern, wporg_closed_at
```

`wporg_status` is one of:

| Value       | Meaning                                             |
| ----------- | --------------------------------------------------- |
| `available` | Published on wordpress.org now                      |
| `closed`    | Was published, since **withdrawn** by the directory |
| `absent`    | Never listed — premium, in-house, or a fake         |
| `unknown`   | Not resolved yet                                    |

**Why this matters.** A plugin is often pulled from the directory _because_ of an unpatched vulnerability. Such a plugin frequently has no CVE and no Wordfence record, so it appears nowhere else in this API — `has_vulnerabilities` will be `false` and the site will look clean. `wporg_closure_reason` carries wordpress.org's own reason: `security-issue`, `guideline-violation`, `author-request`, `licensing-trademark-violation`, and others.

`wporg_closure_is_security_concern` is the classification of that reason, and it is **tri-state**: `true`, `false`, or `null` for a reason nobody has assessed. Filter on this rather than string-matching `security-issue`, which misses both the unclassified reasons and any new one wordpress.org introduces.

There is no fix to recommend for these. The plugin cannot be updated — it must be removed and replaced.

---

## Traps

These are the ways a correct response gets read wrongly. Most were found the hard way.

### A stale site is not a vulnerable site

The single most likely false positive. A site that has not synced recently reports whatever it last reported, which may be months old. It looks identical to a site that is genuinely unpatched.

**Always read `versions_last_checked_at` and `is_dev` before concluding anything about drift.** A dev VM that is powered off most of the time will sit on an old version indefinitely and is not a finding.

```json
{
  "domain": "leyland.local",
  "is_dev": true,
  "versions_last_checked_at": "2026-08-08T07:49:19.000Z"
}
```

That site showed as the only one behind on WooCommerce. It was a laptop VM that had been shut down for eight days.

Filter them out server-side rather than reasoning about them afterwards:

```http
GET /api/websites?is_dev=false&checked_within_days=7&component_slug=woocommerce
GET /api/websites?stale_days=7&summary=true
```

`checked_within_days=N` keeps sites that reported within N days and drops sites that have never reported. `stale_days=N` is the opposite: it selects sites silent for N days or more, never-reported included. They cannot be combined. `is_dev` takes `true` or `false`. The `/installs` route accepts `is_dev` too, and carries `versions_last_checked_at` on every site.

### `has_vulnerabilities` and `is_malware` are independent

Neither implies the other. A component flagged as known malware reports `has_vulnerabilities: false` unless an actual vulnerability has also been recorded against that release. Branch on both.

(Between v1.34.0 and v1.35.x they were deliberately coupled; that was removed in v1.36.0. Ignore any older guidance.)

### `wporg_status: unknown` does not mean "fine"

It means nobody has asked wordpress.org yet. Treat it as absence of data, never as a clean result. Roughly half the catalogue was `unknown` immediately after the feature shipped.

### An unclassified closure reason is not a safe closure

`wporg_closure_is_security_concern` is tri-state: `true`, `false`, `null`. `null` means _nobody has decided_, not _harmless_. wordpress.org owns this vocabulary and adds to it, so treat an unfamiliar reason as valid and unassessed rather than as an error or an all-clear.

Filtering `?wporg_closure_reason=security-issue` gives you only the confirmed ones. To catch everything that might matter, take all closures and treat `false` as the only cleared state.

The largest install count on the fleet at the time of writing was a plugin closed in 2011 with `reason: unknown` on 29 sites. It would be invisible to a filter that only looked for `security-issue`.

### `vulnerability_count` counts components, not vulnerabilities

It is the number of installed plugins and themes with at least one recorded vulnerability. A component with three CVEs counts once. It covers WordPress plugins and themes only — npm packages are not included.

### Watch the payload

Each site is roughly 5.9 KB of JSON, because the response embeds every plugin and theme. A whole-fleet pull of ~300 sites is around 1.8 MB — on the order of 450k tokens to answer a question that may need three fields.

Server-side cost is not the issue (`limit=50` returns in ~330 ms). Token cost is. Prefer a filter that narrows server-side over pulling the fleet and filtering locally, and add `summary=true` whenever you do not need the component lists. There is no general `fields=` selector.

`limit` is capped at `API_MAX_PAGE_SIZE` (default 200) and a larger value is a `400`, not a silent clamp. Page rather than trying to pull everything at once — and prefer not needing to.

### Filter parameters are validated, not best-effort

A modifier without the parameter it modifies is a `400`, not a silently wider result set:

```
?component_version=8.5.0                    -> 400  (needs component_slug)
?component_type=wordpress-plugin            -> 400  (needs an anchor)
?component_slug=x&component_type=wordpress-plugins -> 400  (no such type)
?wporg_status=withdrawn                     -> 400  (not a status)
```

`?component_version=8.5.0` alone used to return the whole fleet, which reads as "every site runs 8.5.0". Watch the singular/plural trap in particular: the response field is `wordpress-plugins`, the filter value is `wordpress-plugin`.

Read `error` and `message` on a 400 — `message` names the valid values.

### `q` searches the domain and title, nothing else

`?q=` on `/api/websites` is a case-insensitive substring match against the **domain or the title** (domain only before v1.43.0). It does not search owners or component names. Use `user_id` and `component_slug` for those. A short `q` matches broadly, so check `total` before assuming the first row is the site you meant.

---

## What this API cannot tell you

Worth knowing so you do not infer it:

- **Severity or CVSS.** The `vulnerabilities` array holds disclosure URLs, nothing more. There is no severity, no CVE field, no description. Ranking by "how bad" is not possible from this data alone.
- **Whether a site is actually exploited.** Everything here is inventory plus known-bad lists.
- **A person's name.** Accounts are email addresses. There is no name to search on.
- **Premium plugin versions.** Anything not on wordpress.org has no `latest_version` unless it arrived via an ingest feed. See `blind_spots`.
- **Theme closure status.** `wporg_status` is populated for `wordpress-plugin` components; wordpress.org's theme endpoint is not wired up.
- **Fix availability for a withdrawn plugin.** There is none by definition.

Cross-referencing these against sources outside VULNZ is the point of doing this from an agent rather than from a report template.

---

## Conventions

- **`id` serialisation is not consistent between endpoints.** `/api/components/search` returns `id` as a **string** (the column is a `BIGINT`); `/api/websites` returns it as a **number**. Do not compare ids across endpoints without normalising, and do not assume either type.
- Dates ending `_at` are ISO 8601 timestamps, except `wporg_closed_at`, which is a plain `YYYY-MM-DD` date with no time component.
- Pagination is `page` (1-based) and `limit`; `total` is the count across all pages.
- Every authenticated call is written to `api_call_logs` with the full query string, so queries are attributable after the fact.
