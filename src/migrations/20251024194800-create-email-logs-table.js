const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS email_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      recipient_email VARCHAR(255) NOT NULL,
      email_type VARCHAR(255) NOT NULL,
      status VARCHAR(255) NOT NULL,
      sent_at DATETIME NOT NULL,
      INDEX sent_at_index (sent_at ASC)
    )
  `;
  await db.query(query);
};

module.exports = {
  up,
};
