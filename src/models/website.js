const db = require('../db');

const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS websites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      domain VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_ssl BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY user_website (user_id, domain),
      KEY domain_idx (domain)
    )
  `;
  await db.query(query);
};

const findAll = async (userId, limit, offset) => {
    let query = 'SELECT * FROM websites';
    const params = [];
    if (userId) {
        query += ' WHERE user_id = ?';
        params.push(userId);
    }
    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = await db.query(query, params);
    return Array.isArray(rows) ? rows : [];
};

const countAll = async (userId) => {
    let query = 'SELECT COUNT(*) as count FROM websites';
    const params = [];
    if (userId) {
        query += ' WHERE user_id = ?';
        params.push(userId);
    }
    const rows = await db.query(query, params);
    return Number(rows[0].count);
};

const findByDomain = async (domain) => {
    const rows = await db.query('SELECT * FROM websites WHERE domain = ?', [domain]);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

const create = async (website) => {
    const { user_id, domain, title } = website;
    const result = await db.query('INSERT INTO websites (user_id, domain, title) VALUES (?, ?, ?)', [user_id, domain, title]);
    const insertId = result.insertId || result[0]?.insertId;
    return { id: insertId, ...website };
};

const update = async (domain, website) => {
    const fields = Object.keys(website);
    const values = Object.values(website);
    const setClause = fields.map(field => `${field} = ?`).join(', ');

    if (fields.length === 0) {
        return false;
    }

    const query = `UPDATE websites SET ${setClause} WHERE domain = ?`;
    const params = [...values, domain];

    const result = await db.query(query, params);
    return result.affectedRows > 0;
};

const remove = async (domain) => {
    const result = await db.query('DELETE FROM websites WHERE domain = ?', [domain]);
    return result.affectedRows > 0;
};


module.exports = {
  createTable,
  findAll,
  countAll,
  findByDomain,
  create,
  update,
  remove,
};
