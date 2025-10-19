const db = require('../db');

const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS website_components (
      website_id BIGINT UNSIGNED NOT NULL,
      release_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (website_id, release_id),
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
    )
  `;
  await db.query(query);
};

module.exports = {
  createTable,
};
