const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE,
    ADD INDEX IF NOT EXISTS paused_idx (paused)
  `;
  await db.query(query);
};

module.exports = {
  up,
};
