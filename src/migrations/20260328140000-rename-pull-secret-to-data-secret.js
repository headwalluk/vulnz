const db = require('../db');

const up = async () => {
  // Only rename if the column still has the old name (pull_secret).
  // On fresh installs the first migration already creates it as data_secret.
  const columns = await db.query(`SHOW COLUMNS FROM notification_sites LIKE 'pull_secret'`);
  if (columns.length > 0) {
    await db.query(`ALTER TABLE notification_sites CHANGE pull_secret data_secret VARCHAR(255) NOT NULL`);
  }
};

module.exports = { up };
