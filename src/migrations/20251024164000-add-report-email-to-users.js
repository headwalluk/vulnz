const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD COLUMN reporting_email VARCHAR(255) NULL
  `;
  await db.query(query);
};

module.exports = {
  up,
};
