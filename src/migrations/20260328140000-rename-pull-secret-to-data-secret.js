const db = require('../db');

const up = async () => {
  await db.query(`ALTER TABLE notification_sites CHANGE pull_secret data_secret VARCHAR(255) NOT NULL`);
};

module.exports = { up };
