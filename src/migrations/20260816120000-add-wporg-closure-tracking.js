const db = require('../db');

/**
 * M17.7 — Distinguish a closed wordpress.org plugin from one that never existed
 *
 * wordpress.org answers HTTP 404 for two completely different situations, and
 * the sync has been collapsing them into one:
 *
 *   {"error":"Plugin not found."}
 *     — the directory has never heard of this slug. A premium plugin, an
 *       in-house build, or a fake dropped by an attacker.
 *
 *   {"error":"closed", "closed_date":"2024-10-17", "reason":"security-issue",
 *    "name":"...", ...}
 *     — the plugin WAS in the directory and has since been withdrawn.
 *
 * `syncPluginComponent()` branched on the status code alone, so both became
 * `wporg_available = 0` and the closed body was discarded unread. That threw
 * away a first-class security signal: a plugin is frequently pulled from the
 * directory *because* of an unpatched vulnerability, and a site still running
 * one is running something wordpress.org withdrew. Sampling 40 such
 * components on dev returned 29 `security-issue`, 2 `author-request`, 1
 * `guideline-violation`, 1 `licensing-trademark-violation`, 1 `unknown` and 6
 * genuine not-founds — so the signal is not a rare edge case, it is the
 * common case.
 *
 * Adds:
 *  - `wporg_statuses` — slug-keyed lookup, not a DB ENUM, matching
 *    malware_sources/sync_priorities/urgency_sources/component_types.
 *  - `wporg_closure_reasons` — wordpress.org's own reason vocabulary, with
 *    `is_security_concern` so a consumer can act on the distinction without
 *    hardcoding the slug list. Nullable on purpose: NULL means "we have not
 *    classified this reason yet", which is what an unrecognised reason
 *    arriving from wordpress.org gets. Defaulting an unseen reason to 0 would
 *    quietly assert something is safe when nobody has looked.
 *  - `components.wporg_status_slug` / `wporg_closure_reason_slug` /
 *    `wporg_closed_at`.
 *
 * `wporg_available` is deliberately left in place and still maintained by the
 * sync. `src/lib/watchlist.js` reads it to decide whether to probe, and this
 * migration has no way to tell a pre-existing 0 apart from a closure. Rather
 * than guess, every existing 0 becomes `unknown` and gets re-resolved on its
 * next sync — see `vulnz wporg:reclassify` for doing that deliberately rather
 * than waiting for the background rotation.
 */

const STATUSES = [
  ['unknown', 'Not yet determined'],
  ['available', 'Published on wordpress.org'],
  ['closed', 'Was published on wordpress.org, since withdrawn'],
  ['absent', 'Never published on wordpress.org'],
];

/**
 * wordpress.org's closure reasons. The five confirmed against the live API
 * are seeded with a decided `is_security_concern`; the rest are its
 * documented vocabulary, seeded so the common cases do not arrive as
 * unclassified. Anything not listed here is inserted by the sync with a NULL
 * flag and a warning, so a new reason is recorded verbatim rather than lost.
 */
const CLOSURE_REASONS = [
  ['security-issue', 'Security Issue', 1],
  ['guideline-violation', 'Guideline Violation', 0],
  ['licensing-trademark-violation', 'Licensing or Trademark Violation', 0],
  ['author-request', 'Author Request', 0],
  ['merged-into-core', 'Merged Into WordPress Core', 0],
  ['unused', 'Unused', 0],
  ['unknown', 'Unknown', null],
];

const up = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wporg_statuses (
      slug VARCHAR(50) NOT NULL PRIMARY KEY,
      title VARCHAR(100) NOT NULL
    )
  `);

  for (const [slug, title] of STATUSES) {
    await db.query('INSERT INTO wporg_statuses (slug, title) VALUES (?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title)', [slug, title]);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS wporg_closure_reasons (
      slug VARCHAR(50) NOT NULL PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      is_security_concern TINYINT(1) NULL
    )
  `);

  for (const [slug, title, isSecurityConcern] of CLOSURE_REASONS) {
    await db.query('INSERT INTO wporg_closure_reasons (slug, title, is_security_concern) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title)', [
      slug,
      title,
      isSecurityConcern,
    ]);
  }

  await db.query(`
    ALTER TABLE components
    ADD COLUMN wporg_status_slug VARCHAR(50) NOT NULL DEFAULT 'unknown' AFTER wporg_available,
    ADD COLUMN wporg_closure_reason_slug VARCHAR(50) NULL AFTER wporg_status_slug,
    ADD COLUMN wporg_closed_at DATE NULL AFTER wporg_closure_reason_slug
  `);

  await db.query(`
    ALTER TABLE components
    ADD FOREIGN KEY fk_components_wporg_status (wporg_status_slug)
    REFERENCES wporg_statuses(slug)
  `);

  await db.query(`
    ALTER TABLE components
    ADD FOREIGN KEY fk_components_wporg_closure_reason (wporg_closure_reason_slug)
    REFERENCES wporg_closure_reasons(slug)
  `);

  // Only components confirmed present can be carried over. A stored 0 means
  // "404 seen, reason unrecorded" — it cannot be resolved without asking
  // wordpress.org again, so it stays `unknown` rather than being guessed at.
  await db.query("UPDATE components SET wporg_status_slug = 'available' WHERE wporg_available = 1");

  // Drives "which components are closed", and the security sweep that joins
  // through to the sites running them.
  await db.query(`
    ALTER TABLE components
    ADD INDEX idx_components_wporg_status (component_type_slug, wporg_status_slug)
  `);
};

module.exports = { up };
