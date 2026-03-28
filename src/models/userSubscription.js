'use strict';

const db = require('../db');

const createTable = async () => {
  // Table creation is handled by migration
};

/** Valid effective states from WP/Woo subscriptions */
const EFFECTIVE_STATES = {
  ACTIVE: 'active',
  TRIAL: 'trial',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
  PROVISIONING: 'provisioning',
  TRIAL_PROVISIONING: 'trial-provisioning',
};

/** States that mean the account should be active (unblocked) */
const ACTIVE_STATES = new Set([EFFECTIVE_STATES.ACTIVE, EFFECTIVE_STATES.TRIAL, EFFECTIVE_STATES.PROVISIONING, EFFECTIVE_STATES.TRIAL_PROVISIONING]);

/**
 * Find a subscription by user ID and site ID.
 * @param {number} userId
 * @param {number} siteId
 * @returns {Promise<Object|null>}
 */
async function findByUserAndSite(userId, siteId) {
  const rows = await db.query('SELECT * FROM user_subscriptions WHERE user_id = ? AND site_id = ?', [userId, siteId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Find all subscriptions for a user (across all sites).
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function findByUserId(userId) {
  return db.query(
    `SELECT us.*, ns.site_url
     FROM user_subscriptions us
     JOIN notification_sites ns ON ns.id = us.site_id
     WHERE us.user_id = ?
     ORDER BY ns.site_url`,
    [userId]
  );
}

/**
 * Find a subscription by account_email and site ID.
 * @param {string} accountEmail
 * @param {number} siteId
 * @returns {Promise<Object|null>}
 */
async function findByEmailAndSite(accountEmail, siteId) {
  const rows = await db.query(
    `SELECT us.*, ns.site_url
     FROM user_subscriptions us
     JOIN notification_sites ns ON ns.id = us.site_id
     WHERE us.account_email = ? AND us.site_id = ?`,
    [accountEmail, siteId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Create or update a subscription record.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function upsert(data) {
  const { user_id, site_id, wp_user_id, subscription_id, account_email, effective_state, max_sites, perpetual, renewal_amount, next_renewal_date } = data;

  await db.query(
    `INSERT INTO user_subscriptions
       (user_id, site_id, wp_user_id, subscription_id, account_email, effective_state, max_sites, perpetual, renewal_amount, next_renewal_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       wp_user_id = VALUES(wp_user_id),
       subscription_id = VALUES(subscription_id),
       account_email = VALUES(account_email),
       effective_state = VALUES(effective_state),
       max_sites = VALUES(max_sites),
       perpetual = VALUES(perpetual),
       renewal_amount = VALUES(renewal_amount),
       next_renewal_date = VALUES(next_renewal_date),
       updated_at = CURRENT_TIMESTAMP`,
    [user_id, site_id, wp_user_id, subscription_id || null, account_email, effective_state, max_sites || 0, perpetual ? 1 : 0, renewal_amount || null, next_renewal_date || null]
  );

  return findByUserAndSite(user_id, site_id);
}

/**
 * Determine if a user should be active based on all their subscriptions.
 * Active on ANY source = active (precedence rule).
 * @param {number} userId
 * @returns {Promise<boolean>} True if the user should be active (unblocked)
 */
async function isActiveOnAnySite(userId) {
  const subs = await findByUserId(userId);
  return subs.some((sub) => ACTIVE_STATES.has(sub.effective_state));
}

/**
 * Remove a subscription by user ID and site ID.
 * @param {number} userId
 * @param {number} siteId
 * @returns {Promise<boolean>}
 */
async function remove(userId, siteId) {
  const result = await db.query('DELETE FROM user_subscriptions WHERE user_id = ? AND site_id = ?', [userId, siteId]);
  return result.affectedRows > 0;
}

module.exports = {
  createTable,
  EFFECTIVE_STATES,
  ACTIVE_STATES,
  findByUserAndSite,
  findByUserId,
  findByEmailAndSite,
  upsert,
  isActiveOnAnySite,
  remove,
};
