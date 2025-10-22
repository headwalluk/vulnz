const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS releases (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      component_id BIGINT UNSIGNED NOT NULL,
      version VARCHAR(255) NOT NULL,
      release_date DATE,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
      UNIQUE KEY \`component_id_version_unique\` (\`component_id\`, \`version\`)
    )
  `;
  await db.query(sql);
}

const findOrCreate = async (componentId, version) => {
  let rows = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [componentId, version]);
  let release = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  if (!release) {
    const result = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
    const insertId = result.insertId;
    rows = await db.query('SELECT * FROM releases WHERE id = ?', [insertId]);
    release = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  }
  return release;
};

module.exports = {
  createTable,
  findOrCreate,
};
