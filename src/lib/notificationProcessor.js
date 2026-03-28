'use strict';

const user = require('../models/user');
const apiKey = require('../models/apiKey');
const userSubscription = require('../models/userSubscription');
const notificationQueue = require('../models/notificationQueue');
const crypto = require('crypto');

/**
 * Pull customer and subscription data from a WordPress site's REST API.
 * @param {Object} site - notification_sites row (site_url, data_secret)
 * @param {number} wpUserId - WordPress user ID
 * @returns {Promise<{customer: Object|null, subscription: Object|null}>}
 */
async function pullFromWordPress(site, wpUserId) {
  const baseUrl = site.site_url.replace(/\/+$/, '');
  const headers = {
    'X-Vulnz-Secret': site.data_secret,
    Accept: 'application/json',
  };

  let customer = null;
  let subscription = null;

  // Pull customer data
  try {
    const customerRes = await fetch(`${baseUrl}/wp-json/vulnzwoo/v1/customer/${wpUserId}`, { headers });
    if (customerRes.ok) {
      customer = await customerRes.json();
    } else if (customerRes.status === 404) {
      console.log(`Customer ${wpUserId} not found on ${site.site_url}`);
    } else {
      throw new Error(`Customer pull failed: HTTP ${customerRes.status}`);
    }
  } catch (err) {
    if (err.message.includes('Customer pull failed')) throw err;
    throw new Error(`Customer pull failed: ${err.message}`);
  }

  // Pull subscription data
  try {
    const subRes = await fetch(`${baseUrl}/wp-json/vulnzwoo/v1/subscription/${wpUserId}`, { headers });
    if (subRes.ok) {
      subscription = await subRes.json();
    } else if (subRes.status === 404) {
      console.log(`Subscription for user ${wpUserId} not found on ${site.site_url}`);
    } else {
      throw new Error(`Subscription pull failed: HTTP ${subRes.status}`);
    }
  } catch (err) {
    if (err.message.includes('Subscription pull failed')) throw err;
    throw new Error(`Subscription pull failed: ${err.message}`);
  }

  return { customer, subscription };
}

/**
 * Generate a random password for auto-provisioned users.
 * These users authenticate via API key, not password.
 * @returns {string}
 */
function generateProvisioningPassword() {
  return crypto.randomBytes(32).toString('base64') + '!A1a';
}

/**
 * Process a single notification: pull data from WP, upsert user and subscription.
 * @param {Object} site - notification_sites row
 * @param {number} wpUserId - WordPress user ID
 * @param {string} event - Event type
 */
async function processNotification(site, wpUserId, event) {
  const siteId = parseInt(site.id, 10);

  console.log(`Processing notification: site=${site.site_url} wp_user=${wpUserId} event=${event}`);

  // 1. Pull data from WordPress
  const { customer, subscription } = await pullFromWordPress(site, wpUserId);

  // 2. Handle customer 404 — user deleted on WP side
  if (!customer) {
    console.log(`Customer ${wpUserId} deleted on ${site.site_url} — no action taken`);
    return;
  }

  const accountEmail = customer.account_email || customer.email;

  // 3. Find or create the local user by account_email
  let localUser = await user.findUserByUsername(accountEmail);

  if (!localUser) {
    // Create a new user with the 'user' role
    const password = generateProvisioningPassword();
    localUser = await user.createUser(
      accountEmail,
      password,
      ['user'],
      false, // blocked
      1, // max_api_keys
      '', // reporting_weekday
      null, // reporting_email
      null, // last_summary_sent_at
      false, // enable_white_label
      null, // white_label_html
      false // paused
    );
    console.log(`Created user: ${accountEmail} (id=${localUser.id})`);
  }

  const userId = parseInt(localUser.id, 10);

  // 4. Handle subscription 404 — user exists but no subscription
  if (!subscription) {
    await userSubscription.upsert({
      user_id: userId,
      site_id: siteId,
      wp_user_id: wpUserId,
      subscription_id: null,
      account_email: accountEmail,
      effective_state: userSubscription.EFFECTIVE_STATES.INACTIVE,
      max_sites: 0,
      perpetual: false,
      renewal_amount: null,
      next_renewal_date: null,
    });

    // Compute effective state across all sites and update blocked status
    await syncUserBlockedState(userId);
    console.log(`Subscription removed for ${accountEmail} on ${site.site_url}`);
    return;
  }

  // 5. Upsert subscription record
  const effectiveState = subscription.effective_state || 'active';

  await userSubscription.upsert({
    user_id: userId,
    site_id: siteId,
    wp_user_id: wpUserId,
    subscription_id: subscription.subscription_id || null,
    account_email: accountEmail,
    effective_state: effectiveState,
    max_sites: subscription.max_sites || 0,
    perpetual: Boolean(subscription.perpetual),
    renewal_amount: subscription.renewal_amount || null,
    next_renewal_date: subscription.next_renewal_date || null,
  });

  // 6. Update reporting preferences if provided by the WP subscription
  const reportingUpdates = {};
  if (subscription.reporting_email !== undefined) {
    reportingUpdates.reporting_email = subscription.reporting_email;
  }
  if (subscription.reporting_weekday !== undefined) {
    reportingUpdates.reporting_weekday = subscription.reporting_weekday;
  }
  if (Object.keys(reportingUpdates).length > 0) {
    await user.updateUser(userId, reportingUpdates);
  }

  // 7. Sync blocked state across all sites
  await syncUserBlockedState(userId);

  // 7. Provision API key if the user is active, has none, and is allowed at least one
  const refreshedUser = await user.findUserById(userId);
  if (refreshedUser && !refreshedUser.blocked) {
    const existingKeys = await apiKey.listByUserId(userId);
    const maxKeys = parseInt(refreshedUser.max_api_keys, 10) || 0;
    if (existingKeys.length === 0 && maxKeys >= 1) {
      await provisionApiKey(site, userId, wpUserId, accountEmail);
    }
  }

  console.log(`Processed notification for ${accountEmail}: state=${effectiveState}`);
}

/**
 * Generate an API key for a user and push it back to WordPress.
 * @param {Object} site - notification_sites row
 * @param {number} userId - Local user ID
 * @param {number} wpUserId - WordPress user ID
 * @param {string} accountEmail - For logging
 */
async function provisionApiKey(site, userId, wpUserId, accountEmail) {
  const newKey = await apiKey.createForUser(userId);
  console.log(`Generated API key for ${accountEmail}`);

  // Push API key back to WordPress
  const baseUrl = site.site_url.replace(/\/+$/, '');
  const pushRes = await fetch(`${baseUrl}/wp-json/vulnzwoo/v1/subscription/${wpUserId}/api-key`, {
    method: 'PUT',
    headers: {
      'X-Vulnz-Secret': site.data_secret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ api_key: newKey }),
  });

  if (!pushRes.ok) {
    console.error(`Failed to push API key to ${site.site_url} for user ${wpUserId}: HTTP ${pushRes.status}`);
  } else {
    console.log(`Pushed API key to ${site.site_url} for ${accountEmail}`);
  }
}

/**
 * Compute effective blocked state from all subscriptions and apply it.
 * Active on ANY site = unblocked. All inactive/suspended = blocked.
 * @param {number} userId
 */
async function syncUserBlockedState(userId) {
  const shouldBeActive = await userSubscription.isActiveOnAnySite(userId);
  await user.updateUser(userId, { blocked: !shouldBeActive });
}

/**
 * Process the next batch of queued notifications.
 * @param {number} batchSize
 * @returns {Promise<number>} Number of notifications processed
 */
async function processQueue(batchSize = 10) {
  const pending = await notificationQueue.fetchPending(batchSize);

  if (pending.length === 0) return 0;

  let processed = 0;

  for (const entry of pending) {
    const entryId = parseInt(entry.id, 10);
    await notificationQueue.markProcessing(entryId);

    try {
      const site = {
        id: entry.site_id,
        site_url: entry.site_url,
        data_secret: entry.data_secret,
      };

      await processNotification(site, entry.wp_user_id, entry.event);
      await notificationQueue.markCompleted(entryId);
      processed++;
    } catch (err) {
      console.error(`Queue entry ${entryId} failed:`, err.message);
      await notificationQueue.markFailed(entryId, err.message, entry.attempts + 1, entry.max_attempts);
    }
  }

  return processed;
}

module.exports = {
  pullFromWordPress,
  processNotification,
  provisionApiKey,
  syncUserBlockedState,
  processQueue,
};
