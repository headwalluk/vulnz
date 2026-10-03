const db = require('../db');

const ROLE_USER = 'user';
const ROLE_ADMINISTRATOR = 'administrator';
const ROLES = [ROLE_USER, ROLE_ADMINISTRATOR];

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS roles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE
    )
  `;
  await db.query(sql);
}

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
  ROLES,
};
