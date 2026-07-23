const db = require('../db');

/**
 * M12 — Fast Update Triggers
 *
 * Adds the priority-sync lane and latest-version tracking that the
 * fleet fast-update manifest (`GET /api/wordpress/latest-versions`) is
 * built on:
 *
 *  - `sync_priorities` lookup table (high|low) — a slug-keyed lookup
 *    table rather than a DB ENUM, matching component_types/roles.
 *  - `components.sync_priority_slug` — which lane a component syncs in.
 *  - `components.latest_version` / `latest_version_at` — the current
 *    release per wordpress.org, so the manifest is a direct indexed read
 *    rather than a MAX() over the releases table.
 *  - `components.wporg_available` — NULL unknown / 1 = seen on
 *    wordpress.org (200) / 0 = absent (404). The previous sync collapsed
 *    both 200 and 404 into synced_from_wporg = 1, so premium/blind-spot
 *    plugins were indistinguishable from healthy ones.
 *  - App settings seeds for the static watchlist and the WordPress
 *    core version-status cache.
 */
const up = async () => {
  // 1. sync_priorities lookup table
  await db.query(`
    CREATE TABLE IF NOT EXISTS sync_priorities (
      slug VARCHAR(50) NOT NULL PRIMARY KEY,
      title VARCHAR(100) NOT NULL
    )
  `);

  await db.query(`
    INSERT INTO sync_priorities (slug, title) VALUES
      ('high', 'High — re-synced hourly'),
      ('low', 'Low — background rotation')
    ON DUPLICATE KEY UPDATE slug = slug
  `);

  // 2. New components columns
  await db.query(`
    ALTER TABLE components
    ADD COLUMN sync_priority_slug VARCHAR(50) NOT NULL DEFAULT 'low' AFTER synced_from_wporg,
    ADD COLUMN latest_version VARCHAR(255) NULL AFTER sync_priority_slug,
    ADD COLUMN latest_version_at DATETIME NULL AFTER latest_version,
    ADD COLUMN wporg_available TINYINT(1) NULL AFTER latest_version_at
  `);

  await db.query(`
    ALTER TABLE components
    ADD FOREIGN KEY fk_components_sync_priority (sync_priority_slug)
    REFERENCES sync_priorities(slug)
  `);

  // Supports the high-lane sweep and the manifest query
  await db.query(`
    ALTER TABLE components
    ADD INDEX idx_components_priority (component_type_slug, sync_priority_slug)
  `);

  // 3. App settings — static watchlist and WP core version-status cache.
  //    wordpress.current_version already exists (from the app-settings
  //    migration); the hourly core sync now keeps it current.
  await db.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, description, category, is_system) VALUES
      ('wporg.watchlist_static', 'woocommerce,elementor,advanced-custom-fields,contact-form-7,wordpress-seo,akismet', 'string', 'Comma-separated plugin slugs always kept in the high-priority sync lane, regardless of install count', 'sync', 0),
      ('wporg.watchlist_blind_spots', '[]', 'string', 'JSON array of watchlist slugs that cannot be tracked via the wordpress.org API (premium or missing). Written by the watchlist rebuild, served by the fleet manifest.', 'sync', 0),
      ('wordpress.safe_versions', '{}', 'string', 'JSON map of non-insecure WordPress core versions to status (latest|outdated), from api.wordpress.org stable-check. Anything below latest and not listed is treated as insecure.', 'versions', 1)
    ON DUPLICATE KEY UPDATE setting_key = setting_key
  `);
};

module.exports = { up };
