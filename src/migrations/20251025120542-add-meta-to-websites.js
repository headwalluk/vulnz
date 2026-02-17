const db = require('../db');

async function up() {
  await db.query(`
    ALTER TABLE websites
    ADD COLUMN IF NOT EXISTS meta JSON
  `);
}

async function down() {
  await db.query(`
    ALTER TABLE websites
    DROP COLUMN meta
  `);
}

module.exports = {
  up,
  down,
};
