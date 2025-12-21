const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN enable_white_label BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN white_label_html TEXT NULL
  `;
  await db.query(query);
};

module.exports = {
  up,
};
