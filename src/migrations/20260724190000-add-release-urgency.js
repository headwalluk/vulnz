const db = require('../db');

/**
 * M13 — Urgent update classification
 *
 * The fleet manifest (`GET /api/wordpress/latest-versions`) tells hosts what
 * the latest version of each watchlist plugin is. It cannot tell them whether
 * being behind actually matters. Routine updates are already covered by the
 * overnight cycle; only a security release justifies an immediate,
 * out-of-cycle update across the fleet.
 *
 * wordpress.org exposes no such flag — there is no plugin equivalent of the
 * core stable-check insecure/outdated/latest status. The only signal
 * available at release time is the changelog, so releases are classified by
 * an LLM and the verdict is cached here.
 *
 * Adds:
 *  - `urgency_sources` lookup table — a slug-keyed lookup rather than a DB
 *    ENUM, matching sync_priorities/component_types/roles.
 *  - `releases.changelog` — the wordpress.org changelog section as captured
 *    at sync time. Only populated for high-priority (watchlist) components;
 *    it is the classifier's input and the audit trail for its verdict.
 *  - `releases.is_urgent` / `urgency_summary` / `urgency_source_slug` /
 *    `urgency_checked_at` — the verdict. `urgency_checked_at IS NULL` is the
 *    pending-classification queue.
 *
 * Urgency lives on `releases` rather than `components` so the verdict is
 * retained per version: a component whose latest release is routine may have
 * shipped an urgent one two versions ago, and that history is worth keeping
 * even though the manifest only ever reports the current version.
 */
const up = async () => {
  // 1. urgency_sources lookup table
  await db.query(`
    CREATE TABLE IF NOT EXISTS urgency_sources (
      slug VARCHAR(50) NOT NULL PRIMARY KEY,
      title VARCHAR(100) NOT NULL
    )
  `);

  await db.query(`
    INSERT INTO urgency_sources (slug, title) VALUES
      ('changelog_llm', 'Classified from the wordpress.org changelog by an LLM'),
      ('keyword_override', 'Forced urgent by an unambiguous changelog keyword'),
      ('manual', 'Set by hand via the CLI'),
      ('none', 'No signal available — changelog absent or classifier disabled')
    ON DUPLICATE KEY UPDATE slug = slug
  `);

  // 2. New releases columns
  await db.query(`
    ALTER TABLE releases
    ADD COLUMN changelog MEDIUMTEXT NULL AFTER release_date,
    ADD COLUMN is_urgent TINYINT(1) NOT NULL DEFAULT 0 AFTER changelog,
    ADD COLUMN urgency_summary VARCHAR(255) NULL AFTER is_urgent,
    ADD COLUMN urgency_source_slug VARCHAR(50) NULL AFTER urgency_summary,
    ADD COLUMN urgency_checked_at DATETIME NULL AFTER urgency_source_slug
  `);

  await db.query(`
    ALTER TABLE releases
    ADD FOREIGN KEY fk_releases_urgency_source (urgency_source_slug)
    REFERENCES urgency_sources(slug)
  `);

  // Supports the pending-classification queue drain, which selects releases
  // with a NULL urgency_checked_at.
  await db.query(`
    ALTER TABLE releases
    ADD INDEX idx_releases_urgency_checked (urgency_checked_at)
  `);
};

module.exports = { up };
