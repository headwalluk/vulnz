const db = require('../db');

const ROLE_USER = 'user';
const ROLE_ADMINISTRATOR = 'administrator';
// Writes the shared vulnerability, range and release data (the feed importer); no access to accounts or websites
const ROLE_INGEST = 'ingest';
const ROLES = [ROLE_USER, ROLE_ADMINISTRATOR, ROLE_INGEST];
// Roles allowed to write the shared vulnerability database
const VULNERABILITY_WRITER_ROLES = [ROLE_ADMINISTRATOR, ROLE_INGEST];

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS roles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE
    )
  `;
  await db.query(sql);
}

/** Insert any role in ROLES that the roles table lacks. */
async function seedData() {
  for (const role of ROLES) {
    await db.query('INSERT IGNORE INTO roles (name) VALUES (?)', [role]);
  }
}

module.exports = {
  createTable,
  seedData,
  ROLE_USER,
  ROLE_ADMINISTRATOR,
  ROLE_INGEST,
  ROLES,
  VULNERABILITY_WRITER_ROLES,
};
