# Version Matching

How VULNZ decides which releases an advisory affects. This is for contributors changing the matching code, and for integrators who want to know exactly what a posted range will flag.

---

## Ranges, not single versions

Most advisories name a range: "every version below 1.26.7", or "2.0 up to but not including 2.26.5". VULNZ stores the range as stated, then flags every matching release, including releases that only arrive later.

An item posted to `POST /api/vulnerabilities/bulk` carries either one exact `version` or a list of `ranges`:

```json
{ "from": null, "fromInclusive": true, "to": "1.26.7", "toInclusive": false }
```

`null` means unbounded. Each inclusivity flag is required whenever its bound is set, and there are no defaults, because silently reading `<` as `≤` flags the release that fixes the problem. See [API Usage](api-usage.md#reporting-an-affected-range) for the full request format.

A range matches **every** version it covers. It is never narrowed to the major version of its bounds. An advisory reading "< 2.3.4" with no lower bound means every earlier version, 1.x included. Where only one major line is affected, advisories say so with an explicit lower bound.

## Mapping feed formats

Send one bulk item per affected component, carrying all of that component's ranges from the advisory, rather than one item per range.

**Wordfence (v3 feed).** Each `software[]` entry is one item: its `slug` becomes `componentSlug`, and its `type` gives `wordpress-plugin` or `wordpress-theme`. Skip `type: "core"` entries, because VULNZ has no component type for WordPress core. Each value in `affected_versions` becomes one range:

| Wordfence        | Range                                                          |
| ---------------- | -------------------------------------------------------------- |
| `from_version`   | `from`, with `*` sent as `null`                                |
| `from_inclusive` | `fromInclusive` (ignored, and optional, when `from` is `null`) |
| `to_version`     | `to`, with `*` sent as `null`                                  |
| `to_inclusive`   | `toInclusive` (ignored, and optional, when `to` is `null`)     |

Pass the versions through unchanged. Don't pre-sanitise them, and don't collapse a range to one version.

**OSV.** Walk each `ECOSYSTEM` or `SEMVER` range's `events` in order:

- `introduced` opens a range. `"0"` means unbounded (`from: null`); otherwise `fromInclusive: true`.
- `fixed` closes it with `toInclusive: false`.
- `last_affected` closes it with `toInclusive: true`.
- An `introduced` with no closing event means `to: null`.

Several introduced/fixed pairs become several ranges on the same item. `GIT` ranges carry commit hashes, not versions, and don't map to ranges. An advisory's explicit `versions` list can be sent as exact `version` items.

Ranges are only matched reliably for ecosystems whose versions follow the [comparison rules](#comparison-rules): WordPress and npm/semver. Other OSV ecosystems order versions differently: PEP 440's `.post1` and epochs, Maven qualifiers, Debian's `~`, Go pseudo-versions. Their ranges need their own comparator before they are posted.

### Rejected versions

A bound, or an exact `version`, must be a version the comparison rules can parse (see below), made of letters, digits and `.-+_~`. Nothing is guessed. The feeds contain strings like `.51.1`, `47.0(20-11-2023)`, `v.1.1` and `5 alpha 2`, and an item carrying one is rejected with `not a recognisable version`. Rejection is per item: the rest of the batch is still written, and the response lists each failed item by `index` under `errors`. The request returns 400 only when no item in it is valid, and unknown component types are caught at this stage too. Always read `errors`, even on a 200. Clients should log these rejections and count them, not retry them.

## How a range reaches the releases

Readers never evaluate ranges. Every query that asks whether a release is vulnerable joins `vulnerabilities` on `release_id`. Ranges are expanded into those rows ahead of time, at two moments:

1. **When the range is posted.** `vulnerabilityRange.recordRanges()` stores the range in `vulnerability_ranges`, reads every known release of the component, and inserts a `vulnerabilities` row for each release the range matches.
2. **When a release is created.** `release.resolve()` in `src/models/release.js` is the only code that inserts into `releases`. When it creates a new release, it evaluates every stored range for the component against it. This covers every path a release arrives by: a website sync reporting an unseen version, the wordpress.org sync, bulk release ingest, and the CLI.

Both sides write before they read, so a range and a release created at the same moment always meet: whichever finishes second sees the other. Release creation uses `INSERT IGNORE`, so when two requests create the same release, only the one whose insert succeeded applies the ranges.

Posting a range never creates a release. Posting an exact `version` still creates that release, as it always has, and the new release picks up any stored ranges.

## Comparison rules

Implemented in `src/lib/versionCompare.js`.

**Versions are stored as reported.** Every path that creates a release goes through `normaliseReportedVersion()`, which strips tags, trims whitespace and caps the length at 255 characters, and nothing else. A version is never rewritten on the way in, so the comparison below sees what the site or feed actually said. Versions that advisories name, whether range bounds or exact `version` items, are held to the stricter `validateVersion()`. Release versions are not: a site may really be running `trunk`, and that still has to be recorded.

The previous `sanitizeVersion()` rewrote versions (`5.0-RC1` became `5.01`, and `1.0.0-rc.1` became `1.0.0.1`), creating phantom releases and hiding pre-releases from range matching. It has been removed. Rows it created before then may still exist.

- **Parsing.** Trim whitespace, strip a leading `v`, drop semver build metadata (`+…`), then take the numeric core (`\d+(\.\d+)*`). A string with no numeric core cannot be parsed.
- **Numeric core.** Compared segment by segment as integers of any length, with missing segments read as `0`. So `1.26.7` equals `1.26.7.0`, and `1.10` is above `1.9`.
- **Stage suffix.** Ordered the way PHP's `version_compare()` orders them: `dev` < `alpha`/`a` < `beta`/`b` < `rc` < final release < `patch`/`pl`/`p`. Within a stage, the trailing number decides. `6.4-beta2` is below `6.4`, `5.0-RC1` is below `5.0`, and `0.9.8b` is a beta of 0.9.8. The separators `-`, `.`, `_` and `~` are accepted before the stage word, and `-`, `.` and `_` between the word and its number, so npm's `1.0.0-rc.1` parses. `1.0~rc~1` does not: it is an unrecognised suffix.
- **Unrecognised suffix** (`1.7.5-698baaf`, `2026r3`). Compared on its numeric core whenever the cores differ. When the cores are equal, the order is **undecidable**, unless both suffixes are identical, ignoring case, in which case the versions are equal. So `1.7.5-698baaf` matches an inclusive bound of `1.7.5-698baaf`.

### Undecidable means "not flagged"

Range membership has three outcomes: inside, outside, or undecidable. A release is flagged only when it is definitely inside. `1.7.5-698baaf` against "< 1.7.5" is undecidable, so it is not flagged. The same version against "< 1.8" is flagged, because its core decides. A range unbounded on both sides matches every version, including ones that cannot be parsed.

The trade-off is deliberate: an unusual version string can be missed, but a clean release is never flagged on a guess.

### Sorting

Release lists are sorted with `versionSortCompare()`, which needs a total order. It agrees with the comparison rules wherever those decide. Otherwise unparseable versions sort first, and an unrecognised suffix sorts just after the final release of its core.

## Reference URLs

A vulnerability's reference URL can be up to 2048 characters. Both write endpoints reject anything longer rather than letting the database truncate it. Uniqueness in `vulnerabilities` comes from `url_hash`, a SHA-256 of the URL that MariaDB computes and stores. A unique key on the URL itself can't index more than 765 characters in utf8mb4. The hash is case-sensitive, so URLs that differ only in case are distinct. `url_hash` is internal, so read explicit columns rather than `SELECT *`, or the binary value leaks into JSON responses.
