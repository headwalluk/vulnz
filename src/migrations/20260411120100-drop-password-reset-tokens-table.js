const db = require('../db');

const up = async () => {
  await db.query('DROP TABLE IF EXISTS password_reset_tokens');
};

module.exports = { up };
