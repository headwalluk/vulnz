/**
 * Migration: Add WordPress.org metadata fields to components table
 *
 * Adds fields to track plugin maintenance and compatibility:
 * - added: When plugin was first published to WordPress.org (DATE)
 * - last_updated: When plugin was last updated (DATETIME)
 * - requires_php: Minimum PHP version required (VARCHAR)
 * - tested: WordPress version tested up to (VARCHAR)
 *
 * These fields help identify:
 * - Abandoned/unmaintained plugins (old last_updated)
 * - Newly published plugins requiring scrutiny (recent added)
 * - PHP version compatibility issues
 * - WordPress core compatibility status
 */

const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE components
    ADD COLUMN added DATE NULL COMMENT 'Date plugin was first published to WordPress.org',
    ADD COLUMN last_updated DATETIME NULL COMMENT 'Date/time plugin was last updated on WordPress.org',
    ADD COLUMN requires_php VARCHAR(10) NULL COMMENT 'Minimum PHP version required',
    ADD COLUMN tested VARCHAR(10) NULL COMMENT 'WordPress version tested up to'
  `;

  try {
    await db.query(query);
    console.log('Migration 20251210100000: Added WordPress.org metadata fields to components table');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration 20251210100000: Fields already exist, skipping');
    } else {
      throw err;
    }
  }
};

module.exports = {
  up,
};
