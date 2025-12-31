const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE,
    ADD INDEX paused_idx (paused)
  `;
  await db.query(query);
};

module.exports = {
  up,
};
