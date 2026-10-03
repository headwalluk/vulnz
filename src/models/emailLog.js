const db = require('../db');
const logger = require('../lib/logger');

const EMAIL_TYPE_VULNERABILITY_REPORT = 'vulnerability_report';
const EMAIL_TYPE_VULNERABILITY_REPORT_PREVIEW = 'vulnerability_report_preview';

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

/**
 * Record one email send attempt.
 * @param {string} recipientEmail
 * @param {string} emailType
 * @param {string} status
 * @param {{userId?: number|null, ccEmails?: string[]}} [context]  The account the email was for, and who was copied in.
 */
async function logEmail(recipientEmail, emailType, status, { userId = null, ccEmails = [] } = {}) {
  const result = await db.query('INSERT INTO email_logs (user_id, recipient_email, cc_emails, email_type, status, sent_at) VALUES (?, ?, ?, ?, ?, ?)', [
    userId,
    recipientEmail,
    ccEmails.length > 0 ? ccEmails.join(', ') : null,
    emailType,
    status,
    new Date(),
  ]);
  return result.insertId;
}

/**
 * An account's logged emails, newest first.
 * @param {number} userId
 * @param {{emailType?: string|null, limit: number, offset?: number}} options
 */
async function findForUser(userId, { emailType = null, limit, offset = 0 }) {
  let sql = 'SELECT id, recipient_email, cc_emails, email_type, status, sent_at FROM email_logs WHERE user_id = ?';
  const params = [userId];
  if (emailType) {
    sql += ' AND email_type = ?';
    params.push(emailType);
  }
  sql += ' ORDER BY sent_at DESC, id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = await db.query(sql, params);
  return rows.map((row) => ({
    id: parseInt(row.id, 10),
    recipient_email: row.recipient_email,
    cc_emails: row.cc_emails ? row.cc_emails.split(',').map((address) => address.trim()) : [],
    email_type: row.email_type,
    status: row.status,
    sent_at: row.sent_at,
  }));
}

/** Count an account's logged emails. */
async function countForUser(userId, emailType = null) {
  const rows = await db.query(`SELECT COUNT(*) AS count FROM email_logs WHERE user_id = ?${emailType ? ' AND email_type = ?' : ''}`, emailType ? [userId, emailType] : [userId]);
  return Number(rows[0].count);
}

async function purgeOldLogs() {
  const maxAgeDays = parseInt(process.env.EMAIL_LOG_MAX_AGE_DAYS, 10);

  if (isNaN(maxAgeDays) || maxAgeDays <= 0) {
    logger.warn(`EMAIL_LOG_MAX_AGE_DAYS is not set or is invalid (${maxAgeDays}). Skipping log purge.`);
    return;
  }

  const sql = `
    DELETE FROM email_logs
    WHERE sent_at < NOW() - INTERVAL ? DAY
  `;

  try {
    const result = await db.query(sql, [maxAgeDays]);
    logger.info(`Purged ${result.affectedRows} old email logs (days=${maxAgeDays}).`);
  } catch (err) {
    console.error('Failed to purge old email logs:', err);
  }
}

module.exports = {
  createTable,
  logEmail,
  findForUser,
  countForUser,
  EMAIL_TYPE_VULNERABILITY_REPORT,
  EMAIL_TYPE_VULNERABILITY_REPORT_PREVIEW,
  purgeOldLogs,
};
