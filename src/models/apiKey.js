const db = require('../db');
const crypto = require('crypto');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      api_key VARCHAR(64) NOT NULL UNIQUE,
      user_id BIGINT UNSIGNED NOT NULL,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;
  await db.query(sql);
}

function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  createTable,
  generateApiKey
};
