const express = require('express');
const router = express.Router();
const user = require('../models/user');
const { apiAuth } = require('../middleware/auth');
const { sendSummaryEmail } = require('../lib/reporting');

/**
 * @swagger
 * /api/reports/summary-email:
 *   post:
 *     summary: Send a vulnerability summary email
 *     description: Triggers a summary email for the specified user (or the authenticated user if no user_id is provided).
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
 *                 description: User ID to send the report for (defaults to the authenticated user)
 *     responses:
 *       200:
 *         description: Report sent
 *       400:
 *         description: user_id is required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/summary-email', apiAuth, async (req, res) => {
  try {
    const userId = (req.body && req.body.user_id) || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).send('user_id is required');
    }

    const userToSend = await user.findUserById(userId);
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    await sendSummaryEmail(userToSend);

    res.send('Report sent');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
