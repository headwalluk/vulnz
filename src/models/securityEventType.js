const db = require('../db');

async function createTable() {
  // Table is created via migration
  // This function is kept for consistency with other models
}

async function findAll() {
  const sql = 'SELECT * FROM security_event_types ORDER BY severity DESC, title ASC';
  return await db.query(sql);
}

async function findBySlug(slug) {
  const sql = 'SELECT * FROM security_event_types WHERE slug = ?';
  const results = await db.query(sql, [slug]);
  return results[0] || null;
}

async function findById(id) {
  const sql = 'SELECT * FROM security_event_types WHERE id = ?';
  const results = await db.query(sql, [id]);
  return results[0] || null;
}

async function create(slug, title, description, severity = 'warning') {
  const sql = `
    INSERT INTO security_event_types (slug, title, description, severity)
    VALUES (?, ?, ?, ?)
  `;
  const result = await db.query(sql, [slug, title, description, severity]);
  return result.insertId;
}

async function update(id, data) {
  const fields = [];
  const values = [];

  if (data.title !== undefined) {
    fields.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    fields.push('description = ?');
    values.push(data.description);
  }
  if (data.severity !== undefined) {
    fields.push('severity = ?');
    values.push(data.severity);
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(data.enabled);
  }

  if (fields.length === 0) {
    return;
  }

  values.push(id);
  const sql = `UPDATE security_event_types SET ${fields.join(', ')} WHERE id = ?`;
  await db.query(sql, values);
}

async function remove(id) {
  const sql = 'DELETE FROM security_event_types WHERE id = ?';
  await db.query(sql, [id]);
}

async function getEnabledEventTypes() {
  const sql = 'SELECT * FROM security_event_types WHERE enabled = 1 ORDER BY severity DESC, title ASC';
  return await db.query(sql);
}

module.exports = {
  createTable,
  findAll,
  findBySlug,
  findById,
  create,
  update,
  remove,
  getEnabledEventTypes,
};
