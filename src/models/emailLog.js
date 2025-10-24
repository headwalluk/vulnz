const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS email_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      recipient_email VARCHAR(255) NOT NULL,
      email_type VARCHAR(255) NOT NULL,
      status VARCHAR(255) NOT NULL,
      sent_at DATETIME NOT NULL
    )
  `;
  await db.query(sql);
}

async function logEmail(recipientEmail, emailType, status) {
  const result = await db.query('INSERT INTO email_logs (recipient_email, email_type, status, sent_at) VALUES (?, ?, ?, ?)', [recipientEmail, emailType, status, new Date()]);
  return result.insertId;
}

async function purgeOldLogs() {
  const maxAgeDays = parseInt(process.env.EMAIL_LOG_MAX_AGE_DAYS, 7);

  if (isNaN(maxAgeDays) || maxAgeDays <= 0) {
    console.log('EMAIL_LOG_MAX_AGE_DAYS is not set or is invalid. Skipping log purge.');
    return;
  }

  const sql = `
    DELETE FROM email_logs
    WHERE sent_at < NOW() - INTERVAL ? DAY
  `;

  try {
    const [result] = await db.query(sql, [maxAgeDays]);
    console.log(`Purged ${result.affectedRows} old email logs.`);
  } catch (err) {
    console.error('Failed to purge old email logs:', err);
  }
}

module.exports = {
  createTable,
  logEmail,
  purgeOldLogs,
};
