const express = require('express');
const router = express.Router();
const user = require('../models/user');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { sendSummaryEmail } = require('../lib/reporting');
const { ROLE_ADMINISTRATOR } = require('../models/role');

/**
 * @swagger
 * /api/reports/summary-email:
 *   post:
 *     summary: Send a vulnerability summary email
 *     description: >
 *       Triggers a summary email for the authenticated user. Only an
 *       administrator may name another user with `user_id` (since v1.44.0).
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
 *     responses:
 *       200:
 *         description: >
 *           `Report sent`, or `Report not sent: no websites on this account` when the
 *           user has no websites (no email is sent for an empty account).
 *       400:
 *         description: user_id is required
 *       403:
 *         description: A non-administrator named another user
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/summary-email', apiAuth, logApiCall, async (req, res) => {
  try {
    const userId = (req.body && req.body.user_id) || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).send('user_id is required');
    }

    if (String(userId) !== String(req.user.id)) {
      const roles = await user.getRoles(req.user.id);
      if (!roles.includes(ROLE_ADMINISTRATOR)) {
        return res.status(403).send("Only an administrator can send another user's report");
      }
    }

    const userToSend = await user.findUserById(userId);
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    const sent = await sendSummaryEmail(userToSend);

    res.send(sent ? 'Report sent' : 'Report not sent: no websites on this account');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
