const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN reporting_weekday CHAR(3) NOT NULL DEFAULT ''
  `;
  await db.query(query);
};

module.exports = {
  up,
};
