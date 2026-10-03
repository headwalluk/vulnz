const express = require('express');
const router = express.Router();
const user = require('../models/user');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { buildSummaryEmail, sendSummaryEmail } = require('../lib/reporting');
const { renderVulnerabilityReport } = require('../lib/reportRender');
const { ROLE_ADMINISTRATOR } = require('../models/role');

const USER_ID_PATTERN = /^[1-9][0-9]*$/;

/**
 * Resolve the account a report request names (by user_id or username, else the caller); only an administrator may name another.
 * @param {object} caller  The authenticated user row.
 * @param {{userId: *, username: *}} named  Raw request values.
 * @returns {Promise<{status: number, error?: string, message?: string, target?: object, isSelf?: boolean}>}
 */
async function resolveReportTarget(caller, { userId, username }) {
  let result = null;
  if (userId !== undefined && username !== undefined) {
    result = { status: 400, error: 'Conflicting fields', message: 'Give user_id or username, not both.' };
  } else if (userId !== undefined && !USER_ID_PATTERN.test(String(userId))) {
    result = { status: 400, error: 'Invalid user_id', message: 'user_id must be a positive integer.' };
  } else if (username !== undefined && (typeof username !== 'string' || username.trim() === '')) {
    result = { status: 400, error: 'Invalid username', message: 'username must be a non-empty string.' };
  }

  if (!result) {
    // Checked before the lookup, so a non-administrator cannot probe which usernames exist
    let isSelf = true;
    if (userId !== undefined) {
      isSelf = String(userId) === String(caller.id);
    } else if (username !== undefined) {
      isSelf = username.trim().toLowerCase() === String(caller.username).toLowerCase();
    }

    if (!isSelf && !(await user.getRoles(caller.id)).includes(ROLE_ADMINISTRATOR)) {
      result = { status: 403, error: 'Forbidden', message: "Only an administrator can name another user's report." };
    } else {
      let target = caller;
      if (userId !== undefined) {
        target = await user.findUserById(userId);
      } else if (username !== undefined) {
        target = await user.findUserByUsername(username.trim());
      }
      result = target ? { status: 200, target, isSelf } : { status: 404, error: 'Not found', message: 'User not found.' };
    }
  }

  return result;
}

/**
 * @swagger
 * /api/reports/summary-email:
 *   post:
 *     summary: Send a vulnerability summary email
 *     description: >
 *       Sends the summary email for the authenticated user, or for another user
 *       named by `user_id` or `username` (administrators only). Naming another
 *       user also requires `"send": true`, so that call is never made by
 *       accident. To see a report without sending it, use
 *       `GET /api/reports/summary-email/preview`.
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
 *               send:
 *                 type: boolean
 *                 description: Must be true when naming another user
 *     responses:
 *       200:
 *         description: >
 *           `Report sent`, or `Report not sent: no websites on this account` when the
 *           user has no websites (no email is sent for an empty account).
 *       400:
 *         description: >
 *           Another user named without `"send": true`; both user_id and username given;
 *           an invalid user_id or username; send given as anything but true; or `preview`, which has
 *           moved to the GET preview route.
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
    if (body.preview !== undefined) {
      return res.status(400).send('preview is no longer accepted here: GET /api/reports/summary-email/preview returns the report without sending it');
    }
    if (body.send !== undefined && body.send !== true) {
      return res.status(400).send('send must be true when given');
    }

    const resolved = await resolveReportTarget(req.user, { userId: body.user_id, username: body.username });
    if (resolved.status !== 200) {
      return res.status(resolved.status).send(resolved.message);
    }
    if (!resolved.isSelf && body.send !== true) {
      return res
        .status(400)
        .send(`Sending another user's report emails them and their CC list: pass "send": true to confirm, or use GET /api/reports/summary-email/preview to see it without sending`);
    }

    const sent = await sendSummaryEmail(resolved.target);

    res.send(sent ? 'Report sent' : 'Report not sent: no websites on this account');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/reports/summary-email/preview:
 *   get:
 *     summary: Render a user's summary email without sending it
 *     description: >
 *       Builds the report exactly as the weekly email would be, and returns it.
 *       Nothing is sent and nothing is written to the email log. `delivery` is
 *       computed by the same function the sender uses. `would_send` is false when
 *       the weekly job would skip the account, and `skip_reasons` says why. With
 *       no websites there is no report, so `subject`, `html` and `text` are null.
 *       Naming another user is administrator-only.
 *     tags:
 *       - Reports
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *         description: The user to preview (defaults to the authenticated user)
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: The user to preview, by username (account email), instead of user_id
 *     responses:
 *       200:
 *         description: The rendered report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id:
 *                   type: integer
 *                 username:
 *                   type: string
 *                 would_send:
 *                   type: boolean
 *                 skip_reasons:
 *                   type: array
 *                   items:
 *                     type: string
 *                     enum: [no_websites, blocked, paused, no_weekday]
 *                 delivery:
 *                   type: object
 *                   description: Same shape as report_delivery on GET /api/users/{id}, without last_logged_report
 *                 subject:
 *                   type: string
 *                   nullable: true
 *                 html:
 *                   type: string
 *                   nullable: true
 *                 text:
 *                   type: string
 *                   nullable: true
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Both user_id and username given, or an invalid value
 *       403:
 *         description: A non-administrator named another user
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.get('/summary-email/preview', apiAuth, logApiCall, async (req, res) => {
  try {
    const resolved = await resolveReportTarget(req.user, { userId: req.query.user_id, username: req.query.username });
    if (resolved.status !== 200) {
      return res.status(resolved.status).json({ error: resolved.error, message: resolved.message });
    }

    const { emailData, delivery, skipReasons } = await buildSummaryEmail(resolved.target);
    const rendered = emailData ? renderVulnerabilityReport(emailData) : { subject: null, html: null, text: null };

    res.json({
      user_id: parseInt(resolved.target.id, 10),
      username: resolved.target.username,
      would_send: skipReasons.length === 0,
      skip_reasons: skipReasons,
      delivery,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', message: 'The report could not be built.' });
  }
});

module.exports = router;
