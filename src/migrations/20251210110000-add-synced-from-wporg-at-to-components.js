/**
 * Migration: Add synced_from_wporg_at timestamp to components table
 *
 * Enables periodic re-sync of plugin metadata from WordPress.org:
 * - synced_from_wporg (BOOLEAN): 0 = needs sync, 1 = synced
 * - synced_from_wporg_at (DATETIME): When last synced (NULL = never)
 *
 * Strategy:
 * - syncNextPlugin() prioritizes oldest synced_from_wporg_at (NULL first)
 * - Cron job periodically sets synced_from_wporg=0 for plugins older than 7 days
 * - Website component updates set synced_from_wporg=0 for immediate re-sync
 */

const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE components
    ADD COLUMN synced_from_wporg_at DATETIME NULL 
      COMMENT 'When plugin metadata was last synced from WordPress.org',
    ADD INDEX idx_wporg_sync (component_type_slug, synced_from_wporg, synced_from_wporg_at)
  `;

  try {
    await db.query(query);
    console.log('Migration 20251210110000: Added synced_from_wporg_at timestamp to components table');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration 20251210110000: Field already exists, skipping');
    } else {
      throw err;
    }
  }
};

module.exports = {
  up,
};
