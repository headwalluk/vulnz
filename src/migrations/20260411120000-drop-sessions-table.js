const db = require('../db');

const up = async () => {
  await db.query('DROP TABLE IF EXISTS sessions');
};

module.exports = { up };
