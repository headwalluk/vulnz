'use strict';

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

/**
 * List all API keys for a given user.
 * @param {number} userId
 * @returns {Promise<Array<{id: number, api_key: string, createdAt: Date}>>}
 */
async function listByUserId(userId) {
  return db.query('SELECT id, api_key, createdAt FROM api_keys WHERE user_id = ? ORDER BY createdAt ASC', [userId]);
}

/**
 * Generate and store a new API key for a user.
 * @param {number} userId
 * @returns {Promise<string>} The newly generated API key string
 */
async function createForUser(userId) {
  const key = generateApiKey();
  await db.query('INSERT INTO api_keys (api_key, user_id) VALUES (?, ?)', [key, userId]);
  return key;
}

/**
 * Find an API key record by its key string.
 * @param {string} key
 * @returns {Promise<{id: number, api_key: string, user_id: number, createdAt: Date}|null>}
 */
async function findByKey(key) {
  const rows = await db.query('SELECT id, api_key, user_id, createdAt FROM api_keys WHERE api_key = ?', [key]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Revoke (delete) an API key by its key string.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function revokeByKey(key) {
  await db.query('DELETE FROM api_keys WHERE api_key = ?', [key]);
}

module.exports = {
  createTable,
  generateApiKey,
  listByUserId,
  createForUser,
  findByKey,
  revokeByKey,
};
