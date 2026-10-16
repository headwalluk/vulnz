const db = require('../db');

/**
 * M30 — Patched components
 *
 * Records that an installed release on one website has been patched in place.
 * Kept out of website_components because a site sync deletes and re-inserts those
 * rows. Keyed on the release, so an update to another version drops the mark;
 * rows for releases no longer installed are pruned on sync.
 */
const up = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS website_component_patches (
      website_id BIGINT UNSIGNED NOT NULL,
      release_id BIGINT UNSIGNED NOT NULL,
      patched_at DATETIME NOT NULL,
      patched_by_user_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (website_id, release_id),
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
      FOREIGN KEY (patched_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
};

module.exports = { up };
