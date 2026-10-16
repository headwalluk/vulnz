const db = require('../db');

/**
 * M31 — Component release feeds
 *
 * Where a component's latest version comes from when wordpress.org does not
 * publish it. Each component may have one feed: a type, a URL and handler
 * params. The importer reads the list, fetches each feed and posts results to
 * /api/release-feeds/results; only that route writes the status columns.
 *
 * `components.latest_version_source` records who set `latest_version`. The
 * wordpress.org sync was the only writer before this migration, so every
 * existing value is backfilled as `wordpressorg`.
 */

const FEED_TYPES = [
  ['wordpressorg', 'wordpress.org plugin directory'],
  ['github-releases', 'GitHub releases'],
  ['edd-sl', 'Easy Digital Downloads Software Licensing'],
  ['rss', 'RSS or Atom feed'],
  ['html-llm', 'Web page read by an LLM'],
];

const up = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS release_feed_types (
      slug VARCHAR(50) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL
    )
  `);

  for (const [slug, title] of FEED_TYPES) {
    await db.query('INSERT INTO release_feed_types (slug, title) VALUES (?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title)', [slug, title]);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS component_release_feeds (
      component_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      feed_type_slug VARCHAR(50) NOT NULL,
      feed_url VARCHAR(2048) NOT NULL,
      params JSON NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      last_checked_at DATETIME NULL,
      last_success_at DATETIME NULL,
      last_version_found VARCHAR(255) NULL,
      consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
      last_error VARCHAR(1024) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
      FOREIGN KEY (feed_type_slug) REFERENCES release_feed_types(slug),
      KEY idx_release_feeds_type (feed_type_slug, is_enabled)
    )
  `);

  await db.query(`
    ALTER TABLE components
    ADD COLUMN latest_version_source VARCHAR(50) NULL AFTER latest_version_at
  `);

  await db.query(`
    ALTER TABLE components
    ADD FOREIGN KEY fk_components_latest_version_source (latest_version_source)
    REFERENCES release_feed_types(slug)
  `);

  await db.query("UPDATE components SET latest_version_source = 'wordpressorg' WHERE latest_version IS NOT NULL");
};

module.exports = { up };
