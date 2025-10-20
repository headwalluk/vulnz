const db = require('../db');

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
  const roles = ['user', 'administrator'];
  for (const role of roles) {
    await db.query('INSERT IGNORE INTO roles (name) VALUES (?)', [role]);
  }
}

module.exports = {
  createTable,
  seedData,
};
