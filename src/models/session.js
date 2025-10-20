const db = require('../db');

async function createTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL PRIMARY KEY,
      expires INT(11) UNSIGNED NOT NULL,
      data TEXT
    )
  `;
  await db.query(query);
}

module.exports = {
  createTable,
};
