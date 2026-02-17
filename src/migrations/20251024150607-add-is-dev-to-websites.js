const db = require('../db');

module.exports = {
  up: async () => {
    await db.query(`
      ALTER TABLE websites
      ADD COLUMN IF NOT EXISTS is_dev BOOLEAN NOT NULL DEFAULT FALSE
    `);
  },
  down: async () => {
    await db.query(`
      ALTER TABLE websites
      DROP COLUMN is_dev
    `);
  },
};
