# MCP Server — Initial Requirements

**Status:** draft / requirements capture
**Author:** Zee (with Paul)
**Created:** 2026-04-11

An MCP (Model Context Protocol) server exposing the VULNZ API to external AI agents. Two audiences: **public agents** doing open research (e.g. writing up a vulnerability report) and **authenticated agents** acting on a user's own monitored sites.

This document captures what the agents need, what gaps exist in the current data model, and what the delivery shape looks like. It is a requirements doc — not a plan yet. Milestones will be derived from it once we've agreed the scope.

---

## 1. Target Use Cases

### 1A. Public research agent

An external AI (e.g. a security researcher's Claude instance) wants to investigate a plugin or vulnerability for a write-up. It has no account with us and no specific site in mind — it's doing open-source research.

### 1B. Authenticated monitoring agent

An external AI acting on behalf of a VULNZ user. It has been given an API key and wants to report on the user's monitored sites — triage risks, find cross-site exposure, plan upgrades.

These two audiences share most of the underlying data but differ in auth model, rate-limiting, and which tools are exposed.

---

## 2. Proposed MCP Tools

### Public tools (unauthenticated, rate-limited)

| Tool | Purpose | Returns |
|---|---|---|
| `check_component_version(type, slug, version)` | Is this specific version clean? | Clean/vulnerable flag, CVE list, disclosure links (Wordfence/NIST/GHSA), suggested safe upgrade target |
| `get_vulnerability_timeline(type, slug)` | Patch cadence and history | Chronological list of vulns, fix releases, time-to-patch per incident |
| `search_vulnerabilities(keyword, date_range, severity, ecosystem)` | Discover trending or recent vulns | Ranked list of vulnerability records with component + severity |
| `get_component_metadata(type, slug)` | Is this component healthy/abandoned? | Author, last updated, download stats, maintenance status, alt suggestions |
| `find_alternatives(category, features?)` | Replacement candidates when a component is dodgy | Ranked list of components in the same category with health signals |

### Authenticated tools (scoped to the caller's sites)

| Tool | Purpose | Returns |
|---|---|---|
| `list_user_sites()` | Inventory of monitored sites | Site IDs, domains, ecosystem, last check |
| `get_site_components(site_id)` | Per-site stack snapshot | Plugins, themes, versions, PHP, DB, core version |
| `check_site_vulnerabilities(site_id)` | Full risk report for one site | Per-component vulns, severity roll-up, recommended actions |
| `find_cross_site_component(type, slug)` | Blast-radius lookup | Which of the caller's sites have this component, at which versions |

### Shared

- All tools return structured JSON with stable field names and a `source_url` where applicable.
- All tools include a `dataFreshness` hint (last ingest timestamp for the relevant feed) so agents can reason about staleness.

---

## 3. Data Model Gaps

The current schema cannot serve most of these tools without extension. The gap analysis:

### 3.1 Vulnerability metadata (critical gap)

**Today**: `vulnerabilities` table has two columns — `release_id` and `url`. A vulnerability is a URL attached to a vulnerable release. No severity, no CVE, no description, no disclosure date, no CVSS, no vuln type. Worse, the ingest pipeline is tightly coupled to Wordfence as a single source — there's no clean way to pull the same data from OSV, GHSA, NIST, or any other feed without creating duplicate, unlinked rows.

The gap is both **breadth** (we're missing most of the fields an agent needs) and **structure** (we can't model multi-source provenance).

#### 3.1.1 Three-table refactor: logical vulns, per-source reports, per-report release claims

Rather than bolting columns onto the existing table, we split `vulnerabilities` into three tables. The goal: preserve each source's view of a vulnerability verbatim, while allowing multiple sources to be linked to the same logical vuln when they agree on a canonical identifier (CVE).

**Table 1 — `vulnerabilities` (logical)**

The thin record representing "a vulnerability exists". Holds only cross-source identifiers and a canonical summary.

- `id` — PK
- `cve_id` — nullable, unique where present
- `canonical_title` — optional; populated from the first report if not manually curated
- `created_at`, `updated_at`

No severity, no description, no affected-release links. All authoritative data lives on the reports.

**Table 2 — `vulnerability_reports` (per-source view)**

One row per (source, source_id). This is the verbatim view a particular feed has of a vulnerability. Wordfence and OSV each get their own row even when they're describing the same underlying vuln — their rows link to the same `vulnerabilities.id` via `vulnerability_id`.

- `id` — PK
- `vulnerability_id` — FK to `vulnerabilities`
- `source_slug` — FK to `vulnerability_sources` lookup (§3.3)
- `source_id` — external ID from that source (Wordfence UUID, OSV ID, GHSA-xxxx-xxxx-xxxx, etc.)
- `severity_slug` — FK to `severities` lookup (§4.1)
- `cvss_score` — decimal(3,1), nullable
- `cvss_vector` — string, nullable
- `vulnerability_type_slug` — FK to `vulnerability_types` lookup (§4.3), nullable
- `title` — source's own short title
- `description` — source's own long-form description (markdown)
- `url` — source's advisory page
- `disclosed_at` — date the source says the vuln was disclosed
- `fetched_at` — when we last ingested this report
- Unique key on `(source_slug, source_id)`

When a source updates its advisory, we **overwrite** the report row. We don't build a time-series of historical versions — that would be an audit log, not a vuln DB. If provenance ever becomes important, add it later.

**Table 3 — `vulnerability_report_affects_release` (per-report release claims)**

Which releases a given report claims are affected. Keyed off `report_id`, **not** `vulnerability_id`. This is deliberate: if Wordfence says 1.0–1.5 are affected and OSV says 1.0–1.4, both claims are preserved verbatim. The query layer decides how to combine them.

- `report_id` — FK to `vulnerability_reports`
- `release_id` — FK to `releases`
- `fixed_in_release_id` — nullable, FK to `releases` — the source's claim of which release contains the fix
- PK: `(report_id, release_id)`

The "effective" set of affected releases for a logical vulnerability is computed at query time — typically the UNION across all linked reports, optionally filtered by caller-chosen source precedence.

#### 3.1.2 Linking rules (dedup on ingest)

Deliberately minimal. No fuzzy matching, ever.

1. **Incoming report has a CVE.** Look up `vulnerabilities` by `cve_id`. Found → link the new report to the existing logical row. Not found → create a new logical row with that CVE and link.
2. **Incoming report has no CVE.** Create a fresh 1:1 logical row for this report. No attempt to merge with existing CVE-less records.
3. **Previously CVE-less report gains a CVE.** When a source updates a report and now supplies a `cve_id` we didn't have before, re-check linkage. If a different logical row already exists for that CVE, flag for manual merge — do not merge automatically, because the new CVE assignment could be a source error.
4. **Manual merge.** A new CLI command `vuln:merge <keeper-id> <loser-id>` reparents all reports from the loser to the keeper, copies the keeper's `cve_id` and `canonical_title` if absent, deletes the loser, and records the merge in an audit log (date, operator, reason). This is the escape hatch when automatic linking misses a genuine duplicate.

**Explicitly rejected:** title-similarity matching, affected-version-range overlap matching, and any other heuristic dedup. These are a trap; we learned this from industry prior art. Manual merge is the only non-CVE linking path.

#### 3.1.3 npm ecosystem notes

The three-table structure is ecosystem-agnostic — it works for npm vulns identically. Two **ingest-layer** (not schema) considerations:

- **Version ranges must be expanded to discrete releases at ingest.** npm sources (OSV, GHSA, Snyk) report affected versions as SemVer ranges (`>=1.2.0 <1.2.3`), not discrete lists. The npm vuln ingest needs a range-expander that resolves each range into a concrete list of `release_id` values. This in turn means **release discovery is a hard prerequisite** for npm multi-source ingest — we need an npm equivalent of the WordPress.org recently-updated feed (poll the npm registry) to populate `releases` before vulns can be linked. Same pattern as WordPress: releases first, vulns second.
- **GHSA identifiers.** GHSA IDs (`GHSA-xxxx-xxxx-xxxx`) are stable and often precede CVE assignment. For now, treat them as `source_id` within the `ghsa` source row — no special handling. Cross-source linkage continues to rely on `cve_id` only. If OSV ingests a GHSA that also carries a CVE alias, use the CVE to link. A generic `vulnerability_aliases` table is deferred; it's the kind of structural scope creep that's easy to add later if real need emerges.

#### 3.1.4 Costs and trade-offs

- **Reads get more joins.** `check_component_version` becomes: release → `vulnerability_report_affects_release` → `vulnerability_reports` → `vulnerabilities`, grouped by logical vuln. Indexing on `release_id` and `vulnerability_id` keeps this cheap, but it's one more join than today.
- **Ingest endpoint gets smarter.** `POST /api/vulnerabilities/bulk` needs to upsert into three tables and apply the linking rules. The shape of the request payload will change — each item is now a report, not a vuln.
- **Downstream consumers need reshaping.** The existing email reports, the vulnz.net admin dashboard, and any vulnz-woo plugin queries that join `vulnerabilities → releases` will need to go through `vulnerability_reports` and `vulnerability_report_affects_release`. Paul has flagged this is fine — the normal test cycle will catch regressions.
- **New admin workflow.** The manual-merge CLI command is new surface that needs tests and documentation.

#### 3.1.5 Migration path

The existing `vulnerabilities` table (two columns: `release_id`, `url`) cannot be trivially mapped into the new shape because it lacks a source identifier. Proposed approach:

1. Create the three new tables alongside the old one. Keep the old table intact during transition.
2. Backfill: for each existing row, create a synthetic `vulnerabilities` logical row, a `vulnerability_reports` row with `source_slug = 'wordfence'` (the only source we've had) and `source_id` derived from the URL, and a `vulnerability_report_affects_release` row linking the report to the release. Preserve the original `url` on the report.
3. Point all readers at the new tables.
4. Rename the legacy `vulnerabilities` table to `vulnerabilities_legacy` for a release cycle, then drop in a follow-up migration.

Backfill correctness is easy to verify: the row count going into the new structure should exactly equal the row count of the old table, and every old `(release_id, url)` pair should appear as a report linked to that release.

### 3.2 Component metadata (partial gap)

**Today**: `components` has `title`, `description`, `url`, `synced_from_wporg`. No author, no last-updated-upstream timestamp, no download stats, no category, no maintenance status.

**Required** (most can sit in a `component_metadata` JSON column to avoid schema churn, mirroring `platform_metadata` on websites):

- `author_name`, `author_url`
- `upstream_last_updated_at` — when the plugin was last released upstream
- `active_installs` — WP.org reports this
- `support_threads`, `support_threads_resolved` — health signal
- `maintenance_status` — derived slug (not stored): `active`, `stale` (no release > 12mo), `abandoned` (no release > 24mo), `closed` (removed from WP.org). Computed at read time — see §4.4
- `category` — FK to the category taxonomy (§4.2)

### 3.3 Taxonomies (new)

No taxonomy tables exist. We need four, all implemented as slug-keyed lookup tables (not DB enums — see §4 preamble):

- **Severity** (§4.1)
- **Component category** (§4.2)
- **Vulnerability type** (§4.3)
- **Vulnerability source** — table `vulnerability_sources`, FK'd from `vulnerability_reports.source_slug` (see §3.1). Columns: `slug`, `label`, `description`, `base_url`, `sort_order`, `is_deprecated`. Initial rows: `wordfence`, `osv`, `nist`, `ghsa`, `patchstack`, `manual`.

See section 4 for the severity/category/vuln-type definitions.

### 3.4 Public endpoints (partial gap)

Only `GET /api/components/search` is currently unauthenticated. All the public MCP tools need either:

- New unauthenticated routes with the same rate-limiter pattern, **or**
- An MCP-server-specific API key that grants read-only access to a curated subset of public endpoints.

The second option is cleaner for abuse control but adds friction for casual integrators. Decision deferred — see §6 open questions.

---

## 4. Proposed Taxonomies

**Design preamble — lookup tables, not enums.** Every taxonomy in this section is implemented as a slug-keyed lookup table with an FK from the consuming table (e.g. `vulnerabilities.severity_slug → severities.slug`). DB-level enums are rejected for these columns because:

- The project already uses slug-keyed lookup tables for `component_types` and `ecosystems` — consistency matters.
- The test suite runs against in-memory SQLite with a MySQL→SQLite translation shim; lookup tables are identical across engines, enums are not.
- Each taxonomy benefits from per-row metadata (severity has a CVSS range and display colour, vuln types have reference URLs, sources have base URLs and trust weight) that enums cannot carry.
- New values can be added with an `INSERT`, deprecated with a flag, and localised if ever needed — none of which enums support.

All lookup tables follow the same shape: `slug` (PK), `label`, `description`, plus type-specific columns, plus `is_deprecated BOOLEAN DEFAULT FALSE` and `sort_order INT` for display.

### 4.1 Severity

Table: `severities`. Aligned with CVSS v3.1 qualitative ratings — the industry standard, and it lets us map external feed data without reinvention.

| Slug | Label | CVSS v3.1 range | Notes |
|---|---|---|---|
| `critical` | Critical | 9.0–10.0 | |
| `high` | High | 7.0–8.9 | |
| `medium` | Medium | 4.0–6.9 | |
| `low` | Low | 0.1–3.9 | |
| `none` | None / Informational | 0.0 | |
| `unknown` | Unknown | (no CVSS assigned) | Default when no feed data |

Columns: `slug`, `label`, `description`, `cvss_min`, `cvss_max` (nullable for `unknown`), `display_colour` (optional, for frontends), `sort_order`. `vulnerabilities.severity_slug` FKs here, derived from `cvss_score` where available and overridable manually.

### 4.2 Component category

Table: `component_categories`. A single flat taxonomy scoped per ecosystem. Start small and expand as needed.

Initial WordPress rows: `ecommerce`, `payments`, `seo`, `analytics`, `forms`, `security`, `backup`, `caching`, `page-builder`, `membership`, `email`, `media`, `social`, `multilingual`, `admin-tools`, `developer-tools`, `integration`, `uncategorised`.

Columns: `slug` (PK component of a composite key with `ecosystem_id`), `ecosystem_id` (FK), `label`, `description`, `sort_order`, `is_deprecated`. `components.category_slug` FKs here. WP.org doesn't publish reliable categories, so initial population will likely be manual or LLM-assisted classification.

### 4.3 Vulnerability type

Table: `vulnerability_types`. Aligned with the Wordfence taxonomy where possible for easy ingest.

Initial rows: `xss` (Cross-Site Scripting), `sqli` (SQL Injection), `csrf`, `rce` (Remote Code Execution), `lfi` (Local File Inclusion), `auth-bypass`, `privilege-escalation`, `idor`, `ssrf`, `open-redirect`, `info-disclosure`, `dos`, `other`.

Columns: `slug` (PK), `label`, `description`, `reference_url` (link to OWASP or CWE entry where one exists), `sort_order`, `is_deprecated`. `vulnerabilities.vulnerability_type_slug` FKs here. Nullable on the vulnerabilities table to allow unclassified imports.

### 4.4 Component maintenance status (derived, not stored as a table)

Computed at read time from `upstream_last_updated_at` and WP.org closure flag:

- `active` — released within 12 months
- `stale` — 12–24 months since last release
- `abandoned` — >24 months since last release
- `closed` — removed from WP.org (explicit flag)
- `unknown` — no upstream data

---

## 5. Delivery Shape

The work splits cleanly into four layers. These will eventually become separate milestones.

### Layer A — Data model foundations

Schema changes to support multi-source vulnerability provenance, richer component metadata, and taxonomies. This is a prerequisite for everything else.

- Migrations for taxonomy lookup tables: `severities`, `vulnerability_types`, `vulnerability_sources`, `component_categories`
- Seed data for all four taxonomies (severity rows with CVSS ranges, initial vuln types, initial source rows, initial WP category list)
- Migrations for the three new vulnerability tables: `vulnerabilities` (logical), `vulnerability_reports` (per-source), `vulnerability_report_affects_release` (per-report release claims) — see §3.1.1
- Backfill migration: create synthetic logical rows and `wordfence`-sourced reports for every existing row in the legacy table; verify row counts match (see §3.1.5)
- Rename legacy `vulnerabilities` table to `vulnerabilities_legacy` for one release cycle, then drop
- Migration for `component_metadata` JSON column on `components` (or discrete columns — TBD)
- New model files: `vulnerabilityReport.js`, `vulnerabilityReportAffectsRelease.js`, `severity.js`, `vulnerabilityType.js`, `vulnerabilitySource.js`, `componentCategory.js`
- New CLI command: `vuln:merge <keeper-id> <loser-id>` for the manual-merge escape hatch (§3.1.2)

### Layer B — Ingest updates

Once the schema is richer, the ingest tools need to populate it.

- Rework `POST /api/vulnerabilities/bulk` payload shape: items are now **reports**, not vulns. Each item carries a source identifier and feeds the three-table linking logic
- Update `vulnz-ingest` Wordfence feed to emit reports with severity, CVE, type, disclosure date, fixed-in version
- Add OSV feed to `vulnz-ingest` as a second source for WordPress plugins/themes — validates the multi-source story end-to-end
- Update `vulnz-ingest` WordPress.org feed to populate component metadata (author, installs, upstream last updated)
- **Prerequisite for npm multi-source ingest**: an npm release discovery job that polls the npm registry and pushes to the existing `POST /api/releases/bulk` endpoint. Vuln ingest for npm cannot land until this exists, because reports need discrete `release_id` links and OSV/GHSA only provide SemVer ranges
- npm vuln ingest: OSV and GHSA as sources, with a SemVer range-expander that resolves each affected range into concrete release IDs at ingest time
- Retrospective backfill for existing records where possible (OSV lookups by plugin slug to enrich the Wordfence-sourced backfill)

### Layer C — Public API surface

New unauthenticated endpoints that the MCP public tools will call. Each needs rate-limiting and Swagger docs.

- `GET /api/public/components/:type/:slug` — metadata + maintenance status
- `GET /api/public/components/:type/:slug/releases` — timeline with vulns per release
- `GET /api/public/components/:type/:slug/versions/:version` — is this version clean? + safe upgrade target
- `GET /api/public/vulnerabilities/search` — keyword/date/severity search
- `GET /api/public/components/alternatives` — by category + ecosystem

Authenticated endpoints for the monitoring tools may already exist via the current `/api/websites` surface — audit needed to confirm.

### Layer D — MCP server

A new package (likely `packages/vulnz-mcp/`) that implements the MCP protocol and maps tools onto the API surface from Layer C.

- Transport: stdio for local use, HTTP/SSE for hosted
- Two modes: public (no auth or shared read-only key) and authenticated (user's API key)
- Tool definitions mirroring §2
- Tests against a local vulnz-api instance
- Distribution: publishable npm package so external agents can `npx vulnz-mcp`

---

## 6. Open Questions

1. **Public auth model** — fully unauthenticated with rate limits, or a "public MCP key" that any visitor can mint? The latter gives us abuse traceability without friction.
2. ~~**Vulnerability table split**~~ — **resolved 2026-04-11**: three-table refactor (`vulnerabilities` / `vulnerability_reports` / `vulnerability_report_affects_release`) to support multi-source provenance. See §3.1.
3. **Category population** — manual curation, WP.org scrape, or LLM classification pass? Scale is ~60k plugins on WP.org alone.
4. **Severity source of truth across sources** — when Wordfence rates a vuln 9.8 and OSV rates it 7.5, which does the API present as "the" severity? Options: (a) highest, (b) caller-chosen source precedence, (c) always return all source views and let the consumer pick. Leaning towards (c) for the MCP tools and (b) as a sensible default for the admin dashboard and email reports.
5. **Alternatives ranking** — by active installs? By vuln-free days? By recent release activity? A composite health score?
6. **Authenticated tool overlap with existing API** — the current `/api/websites` surface may already cover most of layer B's authenticated tools. An audit is needed before building new endpoints.
7. **MCP hosting** — stdio-only (user installs locally) or do we host a remote MCP endpoint at mcp.vulnz.net? Remote hosting implies we're now operating agent infra, with all the support burden that entails.

---

## 7. Non-Goals (for the first pass)

- Write access from MCP — agents should not be able to mutate data, only read. Keeps the security story simple.
- Real-time subscriptions / push — polling is fine for v1.
- Multi-ecosystem parity for everything — WordPress-first, npm-second. PyPI and others are deferred.
- Natural-language query endpoints — the MCP tools are structured; agents do their own NL reasoning.

---

## 8. Next Steps

1. Paul + Zee review this doc and resolve the open questions in §6.
2. Break Layer A into concrete migrations and a milestone (provisional: M10 — Vulnerability & Component Metadata).
3. Audit existing authenticated endpoints against §2's authenticated tool list to see what can be reused.
4. Decide on MCP transport and hosting story before Layer D starts.
