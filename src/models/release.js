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

module.exports = {
  createTable,
};
