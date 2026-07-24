# Urgent Update Classification

**Status:** implemented — M13, v1.33.0 (2026-07-24)
**Author:** Claude Code (with Paul)
**Created:** 2026-07-24

Extends the fast-update manifest ([`12-fast-update-triggers.md`](12-fast-update-triggers.md)) with a single boolean per plugin: `is_urgent`.

M12 answered *"what is the latest version?"*. It could not answer *"does being behind actually matter?"* — so a fleet acting on it alone would force an out-of-cycle update for every routine release, which is both too aggressive and too noisy to run. This adds the missing discriminator.

The fleet-side rule becomes:

> This site runs plugin X, it is behind the manifest's `latest_version`, **and** `is_urgent` is true → update it now. Everything else waits for the overnight cycle.

---

## 1. Why there is no source to pull from

The obvious implementation is to pass through a flag from an upstream source. There isn't one.

**wordpress.org has no plugin security flag.** Verified against the live API on 2026-07-24. `/plugins/info/1.0/{slug}.json` returns `added, author, compatibility, download_link, last_updated, requires, requires_php, requires_plugins, sections, tested, version, versions` — and nothing security-related. The `insecure` / `outdated` / `latest` tri-state that `core/stable-check/1.0/` provides (and that M12 already consumes for `wordpress.current_version`) has **no plugin equivalent**. `upgrade_notice` exists as a field but came back empty for both Yoast and WooCommerce, so it is a bonus signal at best.

**The Wordfence data VULNZ already holds cannot serve this.** Two problems, one structural and one about timing:

- `vulnerabilities` is `(id, release_id, url)`. No CVE, no CVSS, no title, no patched-in version. The bulk endpoint takes `{component, version, urls[]}`, so `vulnz-ingest` is not sending more than that either.
- The row hangs off the **vulnerable** release, not the fixing one. VULNZ can say 10.9.3 is vulnerable; nothing marks 10.9.4 as the fix.
- Even with both fixed, Wordfence publishes days after a patch ships. It cannot serve a 6-hour exposure window.

Third-party structured feeds (Wordfence Intelligence v2, Patchstack) do carry `patched_versions` and CVSS, but their free tiers are generally non-commercial — a licensing question, not a technical one.

**That leaves the changelog**, which is the only signal that exists at the moment a release ships.

---

## 2. What the changelogs actually look like

Measured 2026-07-24 against the live API. This shaped the design more than anything else.

| plugin | changelog size | contents |
|---|---|---|
| `wp-sweep` (1.0 endpoint) | 3.8 KB | full history |
| `wordpress-seo` | 1.4 KB | last 2 versions, then a link |
| `woocommerce` | 428 B | **newest version only**, then a link |

Three consequences:

1. **No extraction problem.** wordpress.org already scopes the changelog to the newest entries. There is no version-section parsing to write and no 40 KB wall of history to trim. Feed it whole.
2. **Cost is a rounding error.** ~400 tokens of changelog plus ~600 of prompt is ~1 K input per classification. The watchlist produces roughly 50–60 new versions a month, so on Haiku that is pennies. Cost was explicitly not a design constraint.
3. **Only the current version is retrievable.** WooCommerce publishes literally one entry. A version whose changelog was not captured at the time can never be classified retrospectively.

### The precision trap

Yoast SEO 28.0, filed under *"Other"*:

> *"Updates the guzzlehttp/guzzle and guzzlehttp/psr7 dependencies to patched releases that address known security advisories."*

A regex on `XSS|RCE|CVE` misses it. A regex on `security` catches it — and then triggers a 3am fleet-wide update for a patched transitive HTTP-client dependency almost certainly unreachable in a default Yoast install. That is exactly the noise this feature exists to remove.

So `is_urgent` cannot mean *"mentions security"*. It means:

> A vulnerability realistically exploitable against a **default installation**, by an unauthenticated or low-privileged attacker, that this release fixes.

Making that distinction is what the LLM is for, and it is why a keyword list alone was rejected as the primary mechanism.

---

## 3. As built

**Two tiers were designed; one was built.** Changelog classification is the fast path and is implemented. The second tier — using the Wordfence feed to flip `is_urgent` true days later, catching silently-patched releases — is **deferred** (§6). It requires schema and `vulnz-ingest` changes that are out of scope here.

**Provider: OpenRouter**, which speaks the OpenAI chat-completions shape. Chosen so model and provider can be swapped from `.env` without code changes. Default `anthropic/claude-haiku-4.5`.

**A general LLM layer, not a one-off.** `src/lib/llm/`:

```
client.js              provider call: key, model, timeout, retry, JSON parse
tasks/index.js         registry — slug → task
tasks/releaseUrgency.js   the first (currently only) task
```

A task is a plain object: `slug`, `description`, optional `modelEnvVar` for a per-task model override, `maxTokens`, `systemPrompt`, `buildUserPrompt(input)`, `parseResult(json)`. Adding a future task (other housekeeping or data-classification work) is a new file plus one registry line — no changes to the client, the CLI, or anything else.

`client.js` holds every provider-specific detail, so switching away from OpenRouter is a change to one file.

**Schema.** `urgency_sources` lookup table (slug-keyed, matching `sync_priorities` — not a DB ENUM), plus five columns on `releases`: `changelog`, `is_urgent`, `urgency_summary`, `urgency_source_slug`, `urgency_checked_at`.

Urgency lives on `releases` rather than `components` because `releases` already has `UNIQUE(component_id, version)`, so the manifest joins cleanly on `latest_version`, and the per-version verdict is retained even though the manifest only reports the current one.

**Pipeline.** The high-priority lane already had `data.sections.changelog` in hand and was reading only `sections.description`. It now stores the changelog on the release row — **fast lane only**, so the ~1,100 background components never carry one. `urgency_checked_at IS NULL` is the pending queue; a separate cron at `20 * * * *` drains it, 20 minutes behind the sync.

Classification is deliberately **not** in the sync loop or the request path. A slow or unavailable provider can never delay the manifest.

**Keyword override.** `remote code execution`, `sql injection`, `authentication bypass`, `privilege escalation`, `arbitrary file upload` force `is_urgent` regardless of the model's verdict. It only ever raises, never lowers — a false positive costs one unnecessary update, a false negative leaves the fleet exposed all day. Deliberately short: a bare CVE reference or the word "security" alone is excluded, because forcing those urgent reintroduces the Yoast-guzzle noise. When the override changes the outcome, `urgency_source_slug` records `keyword_override`, so the audit trail shows what the model would have let through.

**Manifest.** Two new fields per plugin — `is_urgent` and `summary`. `generated_at` now also accounts for `urgency_checked_at`, since a verdict lands ~20 minutes after the version it describes.

**Fails safe in every direction.** `is_urgent` defaults to `false` when classification is disabled, no API key is set, the provider is unreachable, the changelog is missing or unparseable, or the release simply has not been processed yet. Every one of those degrades to the pre-M13 behaviour: the host's overnight cycle picks it up. Failed classifications keep a NULL `urgency_checked_at` and are retried.

**CLI:** `llm:status`, `llm:classify-release <slug> <version> [--save]` (dry run by default), `llm:classify-pending [--limit n]`.

**Schedule:** `20 * * * *`, instance-0 / `CRON_ENABLE` guarded like the rest.

---

## 4. Decisions taken and rejected

**`urgent_since` was designed and dropped.** `is_urgent` describes only the *latest* release, so a site two versions behind — where the security fix was the middle release and the latest is a feature bump — reads as non-urgent. `urgent_since` (the version of the most recent urgent release; host compares `installed < urgent_since`) closes that gap.

Rejected as another moving part to maintain on the fleet side, for a narrow case. Accepted consequence: **a site that misses the urgent release and then sees a routine one on top will not be flagged.** The overnight cycle still catches it within 24 hours. Worth revisiting if it happens in practice.

**Classification lives in vulnz-api, not vulnz-ingest.** Three reasons: latency is the whole product, and routing through `vulnz-ingest`'s coarse schedule would eat the budget the feature exists to protect; `is_urgent` is a property of a `releases` row the API owns, and having a push client own a derived field on someone else's row inverts the data flow; and the API already has the cron machinery, env normalisation, and the watchlist that defines which releases matter.

**No separate backfill was written.** The first draft included one. It turned out to be unnecessary: `syncHighPriorityPlugins()` now captures changelogs, so the existing hourly lane backfills the watchlist on its next sweep and the classifier picks it up 20 minutes later. Manually, it is `wporg:sync-high` then `llm:classify-pending`. One less moving part.

**Fast lane only.** Classifying all ~1,100 plugin slugs would still be cheap, but only the watchlist feeds the manifest, so the rest would be pure cost for no consumer.

---

## 5. Known limitations

- **Silently-patched releases are missed.** Plugin authors routinely ship security fixes described as *"minor bug fixes"*, sometimes at the plugin team's request to avoid tipping off attackers. Changelog classification has a real false-negative floor here, and only the deferred tier-2 vulnerability feed closes it.
- **Blind spots can never be classified.** `elementor-pro`, `revslider` and the rest have no wordpress.org changelog. They stay in `blind_spots[]` and never gain a flag.
- **Retrospective classification is limited** to versions whose changelog was captured at the time.
- **A missed urgent release followed by a routine one is not flagged** — see the `urgent_since` decision in §4.
- **The model is a dependency on someone else's judgement.** The prompt is tuned to require evidence in the changelog and not speculate, but it is a probabilistic classifier making a security-relevant call. `llm:classify-release` exists partly so verdicts can be spot-checked by hand.
- **The "undisclosed details" pattern is the most likely source of future false positives.** Some vendors write only *"this update addressed a security bug"* plus a researcher credit, with no vulnerability class, severity, or attack vector (see `ultimate-addons-for-gutenberg` in §7). Flagging those urgent is the right default — it is exactly the deliberately-vague disclosure the classifier exists to catch — but some vendors use the same wording for admin-only issues, where an out-of-cycle fleet update is not warranted. Worth watching whether it recurs and, if it becomes noisy, whether the prompt should distinguish "undisclosed" from "undisclosed by a vendor with a track record of understating".

---

## 7. First production run (2026-07-24)

Deployed to prod on v1.33.0 and enabled the same evening. Baseline worth keeping for comparison:

**26 of 26 watchlist releases classified, 4 flagged urgent.** All four verified by hand against the live wordpress.org changelogs:

| plugin | evidence in the changelog | correct? |
|---|---|---|
| `wpforms-lite 2.0.0.2` | XSS when a WPForms captcha is combined with a crafted OptinMonster campaign | ✅ |
| `ultimate-addons-for-gutenberg 2.20.0` | *"addressed a security bug"* + WPScan responsible-disclosure credit, no further detail | ✅ |
| `database-collation-fix 1.2.11` | *"Fix vulnerabilty: CVE-2023-23997 sanitize and check forced algorithm"* | ✅ |
| `enable-media-replace 4.2.2` | stored XSS via display name, PatchStack disclosure | ✅ |

No false positives. Two findings from the run:

- **Version scoping holds on full-history changelogs.** `database-collation-fix` publishes its entire changelog back to 2018, including a *"1.2.8 – Fix CSRF vulnerability"* entry. The classifier attributed urgency to 1.2.11 only, and ignored the older security entries. This was the main risk in feeding the changelog blob in whole, and it did not materialise.
- **A 2023 CVE in a 2026 release is not a stale-changelog artifact.** `database-collation-fix 1.2.11` (dated Jul 2026) fixes CVE-2023-23997 — a three-year-old vulnerability only just patched. An old CVE identifier is not evidence that the model picked up a historical entry; check the release date before assuming a false positive.

**The 4/26 ratio is the useful number.** 22 releases that a naive "a newer version exists" trigger would have pushed out of cycle, against 4 that justify it. If a future run flags a much larger share, that is a signal to inspect the prompt or the model rather than the fleet.

**Ordering gotcha:** the first `llm:classify-pending` after the deploy found nothing, because the `:00` sync had run on the pre-deploy code and no changelogs were stored yet. Manual runs must be `wporg:sync-high` *then* `llm:classify-pending`; the crons enforce that ordering themselves (`0 * * * *` then `20 * * * *`).

---

## 6. Deferred

- **Tier 2 — vulnerability-feed backfill.** Extend the Wordfence feed and `POST /api/vulnerabilities/bulk` to carry `patched_in` (and severity), so the API can mark the *fixing* release rather than only the vulnerable one, and flip `is_urgent` true days later for releases the changelog did not disclose. Needs a schema change here and a payload change in `vulnz-ingest`.
- **`urgent_since`**, if the multi-version-behind case shows up in practice.
- **Themes**, inherited from M12 — the fleet reporter still sends none.
- **Notification on urgent classification.** Currently an urgent verdict is logged and served; nothing emails. The manifest is pull-based by design, but a heads-up for the operator may be worth adding.
