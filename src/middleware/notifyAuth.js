'use strict';

const crypto = require('crypto');

/**
 * Server-to-server authentication middleware for notification endpoints.
 * Validates X-Vulnz-Secret header against the configured VULNZ_NOTIFY_SECRET.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function notifyAuth(req, res, next) {
  const secret = req.headers['x-vulnz-secret'];
  const expected = process.env.VULNZ_NOTIFY_SECRET;

  if (!expected) {
    console.error('VULNZ_NOTIFY_SECRET is not configured');
    return res.status(500).send('Notification endpoint not configured');
  }

  if (!secret || secret.length !== expected.length) {
    return res.status(401).send('Unauthorized');
  }

  const match = crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  if (!match) {
    return res.status(401).send('Unauthorized');
  }

  next();
}

module.exports = { notifyAuth };
