const db = require('../db');

async function createTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;
  await db.query(query);
}

async function createToken(userId, token) {
  const query = 'INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)';
  await db.query(query, [userId, token]);
}

async function findToken(token) {
  const query = 'SELECT * FROM password_reset_tokens WHERE token = ?';
  const rows = await db.query(query, [token]);
  return rows[0];
}

async function deleteTokensByUserId(userId) {
  const query = 'DELETE FROM password_reset_tokens WHERE user_id = ?';
  await db.query(query, [userId]);
}

module.exports = {
  createTable,
  createToken,
  findToken,
  deleteTokensByUserId,
};
