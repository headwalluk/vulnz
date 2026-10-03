const db = require('../db');

/**
 * M28: a comma-separated CC list for the weekly report, and the account and
 * CC recorded with each logged email. Each step checks current state, so
 * re-runs are no-ops.
 */

/** Whether a table already has a column. */
async function hasColumn(table, column) {
  const rows = await db.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

const up = async () => {
  if (!(await hasColumn('users', 'reporting_cc'))) {
    await db.query('ALTER TABLE users ADD COLUMN reporting_cc VARCHAR(1000) NULL AFTER reporting_email');
  }
  if (!(await hasColumn('email_logs', 'user_id'))) {
    await db.query('ALTER TABLE email_logs ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id, ADD INDEX email_logs_user_sent (user_id, sent_at)');
  }
  if (!(await hasColumn('email_logs', 'cc_emails'))) {
    await db.query('ALTER TABLE email_logs ADD COLUMN cc_emails VARCHAR(1000) NULL AFTER recipient_email');
  }
};

module.exports = {
  up,
};
