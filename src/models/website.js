const db = require('../db');

const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS websites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      domain VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_ssl BOOLEAN DEFAULT TRUE,
      is_dev BOOLEAN NOT NULL DEFAULT FALSE,
      meta JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY user_website (user_id, domain),
      KEY domain_idx (domain)
    )
  `;
  await db.query(query);
};

const findAll = async (userId, limit, offset, search, onlyVulnerable) => {
  let query = 'SELECT w.* FROM websites w';
  const params = [];
  const whereClauses = [];

  if (onlyVulnerable) {
    query += `
      JOIN website_components wc ON w.id = wc.website_id
      JOIN releases r ON wc.release_id = r.id
      JOIN vulnerabilities v ON r.id = v.release_id
    `;
  }

  if (userId) {
    whereClauses.push('w.user_id = ?');
    params.push(userId);
  }

  if (search) {
    whereClauses.push('w.domain LIKE ?');
    params.push(`%${search}%`);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  if (onlyVulnerable) {
    query += ' GROUP BY w.id';
  }

  query += ' ORDER BY w.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = await db.query(query, params);
  return Array.isArray(rows) ? rows : [];
};

const countAll = async (userId, search, onlyVulnerable) => {
  let query = 'SELECT COUNT(DISTINCT w.id) as count FROM websites w';
  const params = [];
  const whereClauses = [];

  if (onlyVulnerable) {
    query += `
      JOIN website_components wc ON w.id = wc.website_id
      JOIN releases r ON wc.release_id = r.id
      JOIN vulnerabilities v ON r.id = v.release_id
    `;
  }

  if (userId) {
    whereClauses.push('w.user_id = ?');
    params.push(userId);
  }

  if (search) {
    whereClauses.push('w.domain LIKE ?');
    params.push(`%${search}%`);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const rows = await db.query(query, params);
  return Number(rows[0].count);
};

const findByDomain = async (domain) => {
  const rows = await db.query('SELECT * FROM websites WHERE domain = ?', [domain]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

const create = async (website) => {
  const { user_id, domain, title, is_dev, meta } = website;
  const result = await db.query('INSERT INTO websites (user_id, domain, title, is_dev, meta) VALUES (?, ?, ?, ?, ?)', [user_id, domain, title, is_dev, JSON.stringify(meta)]);
  const insertId = result.insertId || result[0]?.insertId;
  return { id: insertId, ...website };
};

const update = async (domain, website) => {
  const fields = Object.keys(website);
  const values = Object.values(website);

  if (website.meta) {
    website.meta = JSON.stringify(website.meta);
  }

  const setClause = fields.map((field) => `${field} = ?`).join(', ');

  if (fields.length === 0) {
    return false;
  }

  const query = `UPDATE websites SET ${setClause} WHERE domain = ?`;
  const params = [...values, domain];

  // Diagnostics
  // console.log( query, params );

  const result = await db.query(query, params);
  return result.affectedRows > 0;
};

const remove = async (domain) => {
  const result = await db.query('DELETE FROM websites WHERE domain = ?', [domain]);
  return result.affectedRows > 0;
};

const touch = async (websiteId) => {
  const result = await db.query('UPDATE websites SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [websiteId]);
  return result.affectedRows > 0;
};

const removeStaleWebsites = async (days) => {
  const result = await db.query('DELETE FROM websites WHERE updated_at < NOW() - INTERVAL ? DAY', [days]);
  return result.affectedRows || 0;
};

module.exports = {
  createTable,
  findAll,
  countAll,
  findByDomain,
  create,
  update,
  remove,
  touch,
  removeStaleWebsites,
};
