const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE users
    ADD INDEX reporting_weekday_idx (reporting_weekday)
  `;
  await db.query(query);
};

module.exports = {
  up,
};
