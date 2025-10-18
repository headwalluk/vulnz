const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS api_call_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      api_key_id BIGINT UNSIGNED NOT NULL,
      route VARCHAR(255) NOT NULL,
      method VARCHAR(10) NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    )
  `;
  await db.query(sql);
}

async function logCall(userId, apiKeyId, route, method) {
  await db.query(
    'INSERT INTO api_call_logs (user_id, api_key_id, route, method) VALUES (?, ?, ?, ?)',
    [userId, apiKeyId, route, method]
  );
}

module.exports = {
  createTable,
  logCall
};
