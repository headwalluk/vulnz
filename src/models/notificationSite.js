'use strict';

const db = require('../db');

const createTable = async () => {
  // Table creation is handled by migration
};

/**
 * Find a site by its URL.
 * @param {string} siteUrl
 * @returns {Promise<Object|null>}
 */
async function findByUrl(siteUrl) {
  const rows = await db.query('SELECT * FROM notification_sites WHERE site_url = ?', [siteUrl]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Find a site by ID.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function findById(id) {
  const rows = await db.query('SELECT * FROM notification_sites WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * List all registered notification sites.
 * @returns {Promise<Array>}
 */
async function findAll() {
  return db.query('SELECT * FROM notification_sites ORDER BY site_url');
}

/**
 * Register a new notification site.
 * @param {string} siteUrl
 * @param {string} pullSecret
 * @param {string|null} ipAllowlist - Comma-separated IPs or null
 * @returns {Promise<Object>}
 */
async function create(siteUrl, pullSecret, ipAllowlist = null) {
  const result = await db.query('INSERT INTO notification_sites (site_url, data_secret, ip_allowlist) VALUES (?, ?, ?)', [siteUrl, pullSecret, ipAllowlist]);
  const id = parseInt(result.insertId, 10);
  return findById(id);
}

/**
 * Update a notification site.
 * @param {number} id
 * @param {Object} fields
 * @returns {Promise<Object|null>}
 */
async function update(id, fields) {
  const allowed = ['site_url', 'data_secret', 'ip_allowlist', 'active'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  await db.query(`UPDATE notification_sites SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(id);
}

/**
 * Remove a notification site by ID.
 * @param {number} id
 * @returns {Promise<boolean>}
 */
async function remove(id) {
  const result = await db.query('DELETE FROM notification_sites WHERE id = ?', [id]);
  return result.affectedRows > 0;
}

module.exports = {
  createTable,
  findByUrl,
  findById,
  findAll,
  create,
  update,
  remove,
};
