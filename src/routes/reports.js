const express = require('express');
const router = express.Router();
const user = require('../models/user');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { sendSummaryEmail } = require('../lib/reporting');
const { resolveReportDelivery } = require('../lib/reportRecipients');
const { ROLE_ADMINISTRATOR } = require('../models/role');

/**
 * @swagger
 * /api/reports/summary-email:
 *   post:
 *     summary: Send a vulnerability summary email
 *     description: >
 *       Triggers a summary email for the authenticated user. Only an
 *       administrator may name another user, with `user_id` (since v1.44.0) or
 *       `username`. With `preview: true` the report is built for that user but sent only
 *       to the caller's own report address, uncopied, with the subject marked
 *       as a preview. It is logged against the caller, not the previewed user.
 *     tags:
 *       - Reports
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               user_id:
 *                 type: integer
 *                 description: User ID to send the report for (administrators only; defaults to the authenticated user)
 *               username:
 *                 type: string
 *                 description: Username (account email) to send the report for, instead of user_id (administrators only)
 *               preview:
 *                 type: boolean
 *                 description: Send the report to the caller instead of the user's recipients
 *     responses:
 *       200:
 *         description: >
 *           `Report sent`, `Preview of the report for <username> sent to <address>`,
 *           or `Report not sent: no websites on this account` when the user has no
 *           websites (no email is sent for an empty account).
 *       400:
 *         description: Both user_id and username given, an empty username, or preview is not a boolean
 *       403:
 *         description: A non-administrator named another user
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/summary-email', apiAuth, logApiCall, async (req, res) => {
  try {
    const body = req.body || {};
    const { preview, username } = body;
    if (body.user_id !== undefined && username !== undefined) {
      return res.status(400).send('Give user_id or username, not both');
    }
    if (username !== undefined && (typeof username !== 'string' || username.trim() === '')) {
      return res.status(400).send('username must be a non-empty string');
    }
    if (preview !== undefined && typeof preview !== 'boolean') {
      return res.status(400).send('preview must be true or false');
    }

    const userId = body.user_id || (username === undefined ? req.user.id : null);
    // Checked before the lookup, so a non-administrator cannot probe which usernames exist
    const isSelf = username === undefined ? String(userId) === String(req.user.id) : username.trim().toLowerCase() === String(req.user.username).toLowerCase();
    if (!isSelf) {
      const roles = await user.getRoles(req.user.id);
      if (!roles.includes(ROLE_ADMINISTRATOR)) {
        return res.status(403).send("Only an administrator can send another user's report");
      }
    }

    const userToSend = username === undefined ? await user.findUserById(userId) : await user.findUserByUsername(username.trim());
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    const sent = await sendSummaryEmail(userToSend, { previewRecipient: preview ? req.user : null });

    let message = 'Report not sent: no websites on this account';
    if (sent && preview) {
      message = `Preview of the report for ${userToSend.username} sent to ${resolveReportDelivery(req.user).to}`;
    } else if (sent) {
      message = 'Report sent';
    }
    res.send(message);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
