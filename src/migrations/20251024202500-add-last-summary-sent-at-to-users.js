const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN last_summary_sent_at DATETIME NULL
  `;
  await db.query(query);
};

module.exports = {
  up,
};
