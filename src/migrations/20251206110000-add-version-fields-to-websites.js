const db = require('../db');

const up = async () => {
  const queries = [
    `ALTER TABLE websites ADD COLUMN IF NOT EXISTS wordpress_version VARCHAR(20) AFTER meta`,
    `ALTER TABLE websites ADD COLUMN IF NOT EXISTS php_version VARCHAR(20) AFTER wordpress_version`,
    `ALTER TABLE websites ADD COLUMN IF NOT EXISTS db_server_type ENUM('mysql', 'mariadb', 'unknown') DEFAULT 'unknown' AFTER php_version`,
    `ALTER TABLE websites ADD COLUMN IF NOT EXISTS db_server_version VARCHAR(20) AFTER db_server_type`,
    `ALTER TABLE websites ADD COLUMN IF NOT EXISTS versions_last_checked_at TIMESTAMP NULL AFTER db_server_version`,
    `ALTER TABLE websites ADD INDEX IF NOT EXISTS idx_wordpress_version (wordpress_version)`,
    `ALTER TABLE websites ADD INDEX IF NOT EXISTS idx_php_version (php_version)`,
  ];

  for (const query of queries) {
    try {
      await db.query(query);
    } catch (err) {
      // Ignore errors for columns/indexes that already exist
      if (!err.message.includes('Duplicate column') && !err.message.includes('Duplicate key')) {
        throw err;
      }
    }
  }
};

module.exports = {
  up,
};
