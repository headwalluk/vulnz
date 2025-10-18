const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS components (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(255) NOT NULL,
      component_type_slug VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      url VARCHAR(255),
      description VARCHAR(4096),
      synced_from_wporg BOOLEAN DEFAULT FALSE,
      UNIQUE(slug, component_type_slug),
      FOREIGN KEY (component_type_slug) REFERENCES component_types(slug)
    )
  `;
  await db.query(sql);
}

module.exports = {
  createTable
};
