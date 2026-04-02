'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { notifyAuth } = require('../middleware/notifyAuth');

// Rate limit: 30 requests per minute per IP (server-to-server, low volume expected)
const notifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.headers['x-forwarded-for'] || req.connection.remoteAddress,
  handler: (req, res) => res.status(429).json({ error: 'Too many requests' }),
});
const notificationSite = require('../models/notificationSite');
const notificationQueue = require('../models/notificationQueue');
const appSetting = require('../models/appSetting');
const { processNotification } = require('../lib/notificationProcessor');

const VALID_EVENTS = new Set(['subscription_created', 'subscription_updated', 'subscription_status_changed', 'manual', 'resend']);

/**
 * @swagger
 * /api/notifications/subscription-changed:
 *   post:
 *     summary: Receive a subscription change notification from a WordPress/WooCommerce site
 *     description: >
 *       Fat-ping endpoint. WordPress sends a lightweight notification when a subscription changes.
 *       The API server then pulls full data from WordPress at its own pace.
 *     tags:
 *       - Notifications
 *     security:
 *       - VulnzSecret: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - site
 *               - event
 *             properties:
 *               user_id:
 *                 type: integer
 *                 description: WordPress user ID
 *               site:
 *                 type: string
 *                 description: Origin site URL
 *               event:
 *                 type: string
 *                 enum: [subscription_created, subscription_updated, subscription_status_changed, manual, resend]
 *     responses:
 *       200:
 *         description: Notification processed immediately
 *       202:
 *         description: Notification queued for async processing
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Invalid or missing X-Vulnz-Secret
 *       403:
 *         description: IP not in site allowlist
 *       422:
 *         description: Unknown or disabled site origin
 *       500:
 *         description: Server error
 */
router.post('/subscription-changed', notifyLimiter, notifyAuth, async (req, res) => {
  try {
    const { user_id, site, event } = req.body;

    // Validate request body
    if (!user_id || !site || !event) {
      return res.status(400).json({ error: 'Missing required fields: user_id, site, event' });
    }

    if (!VALID_EVENTS.has(event)) {
      return res.status(400).json({ error: `Invalid event type: ${event}` });
    }

    // Look up the site
    const siteRecord = await notificationSite.findByUrl(site);
    if (!siteRecord) {
      return res.status(422).json({ error: `Unknown site: ${site}` });
    }

    if (!siteRecord.active) {
      return res.status(422).json({ error: `Site is disabled: ${site}` });
    }

    // Check IP allowlist if configured
    if (siteRecord.ip_allowlist) {
      const allowedIps = siteRecord.ip_allowlist.split(',').map((ip) => ip.trim());
      const clientIp = req.ip;
      if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
        return res.status(403).json({ error: 'IP not in allowlist' });
      }
    }

    // Determine processing mode
    const mode = await appSetting.getWithFallback('notifications.processing_mode', null, 'queue');

    if (mode === 'immediate') {
      // Process synchronously
      await processNotification(siteRecord, user_id, event);
      return res.status(200).json({ status: 'processed', user_id, site, event });
    }

    // Queue for async processing
    const queueId = await notificationQueue.enqueue(parseInt(siteRecord.id, 10), user_id, event);
    return res.status(202).json({ status: 'queued', queue_id: queueId, user_id, site, event });
  } catch (err) {
    console.error('Notification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
