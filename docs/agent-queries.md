# Fleet Queries for an AI Agent

A task-oriented guide to asking VULNZ questions about the whole fleet. [`api-usage.md`](api-usage.md) is the endpoint-by-endpoint reference; this covers what to ask, how to combine filters, and — most importantly — the places where a literal reading of a correct response gives the wrong answer.

---

## Setup

Authenticate with `X-API-Key` on every request.

```bash
source /etc/scripting/script-settings.conf
https --ignore-stdin api.vulnz.net/api/websites "X-API-Key: ${VULNZ_API_KEY}"
```

**Scope comes from the account, not the key.** A key belonging to an `administrator` sees every website in the database; any other user sees only their own. There is no read-only tier — the same key that answers these questions can also delete users, websites and components, so treat it as a write-capable credential even when only reading.

All examples below assume an administrator key.

---

## The queries

### Which sites run a given plugin?

```http
# Any version
GET /api/websites?component_slug=foobar

# One specific release
GET /api/websites?component_slug=foobar&component_version=1.2.3

# Disambiguate a plugin from a theme sharing the slug
GET /api/websites?component_slug=foobar&component_type=wordpress-plugin
```

`total` is the site count. Each entry carries the site's full plugin and theme lists, so the matching version is in `wordpress-plugins[]` alongside everything else installed.

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
GET /api/websites?component_slug=<slug>
# then compare each site's installed version against latest_version
```

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

Every site carrying any withdrawn component, without needing to know a single slug in advance. Composes with the rest — `&only_vulnerable=true`, `&sort=vulnerabilities`, `&component_type=wordpress-plugin`.

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

### Everything about one site

```http
GET /api/websites/{domain}
```

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

There is no `is_dev` filter on `/api/websites` — filter client-side on the returned field.

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

Server-side cost is not the issue (`limit=50` returns in ~330 ms). Token cost is. Prefer a filter that narrows server-side over pulling the fleet and filtering locally. There is no `fields=` selector yet.

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

### `q` searches the domain only

`?q=` is a case-insensitive substring match against the **domain**. It does not search titles, owners or component names — searching for a site by its title returns nothing:

```
q=leyland    -> 2 sites   (matches the domain)
q=LEYLAND    -> 2 sites   (case-insensitive)
q=Local Dev  -> 0 sites   (that string is in the title, not the domain)
```

The Swagger description said "domain or title" until v1.39.0. It was wrong.

---

## What this API cannot tell you

Worth knowing so you do not infer it:

- **Severity or CVSS.** The `vulnerabilities` array holds disclosure URLs, nothing more. There is no severity, no CVE field, no description. Ranking by "how bad" is not possible from this data alone.
- **Whether a site is actually exploited.** Everything here is inventory plus known-bad lists.
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
