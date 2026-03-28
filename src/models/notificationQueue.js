'use strict';

const db = require('../db');

const createTable = async () => {
  // Table creation is handled by migration
};

/** Status constants */
const STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * Add a notification to the queue.
 * @param {number} siteId
 * @param {number} wpUserId
 * @param {string} event
 * @returns {Promise<number>} The queue entry ID
 */
async function enqueue(siteId, wpUserId, event) {
  const result = await db.query('INSERT INTO notification_queue (site_id, wp_user_id, event) VALUES (?, ?, ?)', [siteId, wpUserId, event]);
  return parseInt(result.insertId, 10);
}

/**
 * Fetch the next batch of notifications ready for processing.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
async function fetchPending(limit = 10) {
  return db.query(
    `SELECT nq.*, ns.site_url, ns.data_secret
     FROM notification_queue nq
     JOIN notification_sites ns ON ns.id = nq.site_id
     WHERE nq.status = ? AND (nq.next_retry_at IS NULL OR nq.next_retry_at <= NOW())
     ORDER BY nq.created_at ASC
     LIMIT ?`,
    [STATUS.PENDING, limit]
  );
}

/**
 * Mark a queue entry as processing.
 * @param {number} id
 */
async function markProcessing(id) {
  await db.query('UPDATE notification_queue SET status = ?, attempts = attempts + 1 WHERE id = ?', [STATUS.PROCESSING, id]);
}

/**
 * Mark a queue entry as completed.
 * @param {number} id
 */
async function markCompleted(id) {
  await db.query('UPDATE notification_queue SET status = ?, processed_at = NOW() WHERE id = ?', [STATUS.COMPLETED, id]);
}

/**
 * Mark a queue entry as failed with retry backoff.
 * @param {number} id
 * @param {string} errorMessage
 * @param {number} attempts - Current attempt count
 * @param {number} maxAttempts
 */
async function markFailed(id, errorMessage, attempts, maxAttempts) {
  if (attempts >= maxAttempts) {
    await db.query('UPDATE notification_queue SET status = ?, error_message = ?, processed_at = NOW() WHERE id = ?', [STATUS.FAILED, errorMessage, id]);
  } else {
    // Exponential backoff: 1m, 4m, 9m, 16m, 25m
    const delayMinutes = attempts * attempts;
    await db.query('UPDATE notification_queue SET status = ?, error_message = ?, next_retry_at = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?', [
      STATUS.PENDING,
      errorMessage,
      delayMinutes,
      id,
    ]);
  }
}

/**
 * Get queue status summary.
 * @returns {Promise<Object>}
 */
async function getStatus() {
  const rows = await db.query(`SELECT status, COUNT(*) AS count FROM notification_queue GROUP BY status`);
  const summary = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    summary[row.status] = parseInt(row.count, 10);
  }
  return summary;
}

/**
 * Purge completed/failed entries older than the given number of days.
 * @param {number} days
 * @returns {Promise<number>} Number of rows deleted
 */
async function purgeOld(days) {
  const result = await db.query('DELETE FROM notification_queue WHERE status IN (?, ?) AND processed_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [
    STATUS.COMPLETED,
    STATUS.FAILED,
    days,
  ]);
  return result.affectedRows;
}

module.exports = {
  createTable,
  STATUS,
  enqueue,
  fetchPending,
  markProcessing,
  markCompleted,
  markFailed,
  getStatus,
  purgeOld,
};
