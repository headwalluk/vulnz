const express = require('express');
const router = express.Router();
const user = require('../models/user');
const db = require('../db');
const { apiKeyAdminAuth, apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { ROLE_USER } = require('../models/role');
const { sanitizeEmailHtml } = require('../lib/htmlSanitizer');
const { validateEmailAddress } = require('../lib/emailValidation');

// The only fields a user may change on their own account; roles, limits and status are admin-only.
const SELF_EDITABLE_FIELDS = ['reporting_email', 'reporting_weekday', 'enable_white_label', 'white_label_html'];
// An empty string switches the weekly report off.
const REPORTING_WEEKDAYS = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
// What an administrator may change through the API; credentials and roles are CLI-only, status has its own routes.
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'max_api_keys'];
const WHITE_LABEL_HTML_MAX_LENGTH = 16384;

/**
 * Validate an account update against an allow-list of fields.
 * @returns {{updateData: object}|{error: {error: string, message: string}}}
 */
function validateAccountUpdate(body, allowedFields) {
  const updateData = body && typeof body === 'object' && !Array.isArray(body) ? { ...body } : {};
  const unknownFields = Object.keys(updateData).filter((field) => !allowedFields.includes(field));

  let error = null;
  if (Object.keys(updateData).length === 0) {
    error = { error: 'Nothing to update', message: `Send at least one of: ${allowedFields.join(', ')}.` };
  } else if (unknownFields.length > 0) {
    error = { error: 'Field not editable', message: `Only ${allowedFields.join(', ')} can be changed here. Not editable: ${unknownFields.join(', ')}.` };
  } else if (updateData.reporting_weekday !== undefined && !REPORTING_WEEKDAYS.includes(updateData.reporting_weekday)) {
    error = { error: 'Invalid reporting_weekday', message: `reporting_weekday must be one of: ${REPORTING_WEEKDAYS.map((weekday) => `'${weekday}'`).join(', ')}` };
  } else if (
    updateData.reporting_email !== undefined &&
    updateData.reporting_email !== null &&
    updateData.reporting_email !== '' &&
    !(typeof updateData.reporting_email === 'string' && validateEmailAddress(updateData.reporting_email).isValid)
  ) {
    error = { error: 'Invalid reporting_email', message: 'reporting_email must be a valid email address, or empty to use the account email.' };
  } else if (updateData.white_label_html !== undefined && (typeof updateData.white_label_html !== 'string' || updateData.white_label_html.length > WHITE_LABEL_HTML_MAX_LENGTH)) {
    error = { error: 'Invalid white_label_html', message: `white_label_html must be a string of at most ${WHITE_LABEL_HTML_MAX_LENGTH} characters.` };
  } else if (updateData.enable_white_label !== undefined && typeof updateData.enable_white_label !== 'boolean') {
    error = { error: 'Invalid enable_white_label', message: 'enable_white_label must be a boolean.' };
  } else if (updateData.max_api_keys !== undefined && !(Number.isInteger(updateData.max_api_keys) && updateData.max_api_keys >= 0)) {
    error = { error: 'Invalid max_api_keys', message: 'max_api_keys must be a non-negative integer.' };
  }

  if (!error && updateData.white_label_html !== undefined) {
    updateData.white_label_html = sanitizeEmailHtml(updateData.white_label_html);
  }

  return error ? { error } : { updateData };
}

/** Load one account in its API shape, or undefined when the id does not exist. */
async function findAccountForResponse(userId) {
  const [account] = await db.query(
    'SELECT id, username, blocked, paused, max_api_keys, reporting_weekday, reporting_email, enable_white_label, white_label_html, (SELECT COUNT(*) FROM websites w WHERE w.user_id = users.id) AS website_count FROM users WHERE id = ?',
    [userId]
  );
  let response;
  if (account) {
    const roles = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [account.id]);
    response = {
      ...account,
      id: parseInt(account.id, 10),
      blocked: Boolean(account.blocked),
      paused: Boolean(account.paused),
      enable_white_label: Boolean(account.enable_white_label),
      website_count: Number(account.website_count),
      roles: roles.map((role) => role.name),
    };
  }
  return response;
}

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: API for managing users
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: >
 *       Administrator only. `white_label_html` is not included in the list
 *       (since v1.44.0); read it from `GET /api/users/{id}`.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: >
 *           Case-insensitive substring match against the username (the
 *           account email) or the reporting email. Users have no name field.
 *     responses:
 *       200:
 *         description: A list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       blocked:
 *                         type: boolean
 *                       paused:
 *                         type: boolean
 *                       max_api_keys:
 *                         type: integer
 *                       reporting_weekday:
 *                         type: string
 *                       reporting_email:
 *                         type: string
 *                       enable_white_label:
 *                         type: boolean
 *                       roles:
 *                         type: array
 *                         items:
 *                           type: string
 *                       website_count:
 *                         type: integer
 *                         description: Websites this user owns. List them with `GET /api/websites?user_id=`.
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 */
router.get('/', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const searchQuery = req.query.q || '';

    let usersData;
    let totalUsers;
    const queryParams = [];

    let baseQuery =
      'SELECT id, username, blocked, paused, max_api_keys, reporting_weekday, reporting_email, enable_white_label, (SELECT COUNT(*) FROM websites w WHERE w.user_id = users.id) AS website_count FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';

    if (searchQuery) {
      baseQuery += ' WHERE username LIKE ? OR reporting_email LIKE ?';
      countQuery += ' WHERE username LIKE ? OR reporting_email LIKE ?';
      queryParams.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    baseQuery += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    usersData = await db.query(baseQuery, queryParams);

    for (let u of usersData) {
      const roles = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [u.id]);
      u.roles = roles.map((r) => r.name);
    }

    const countParams = searchQuery ? [`%${searchQuery}%`, `%${searchQuery}%`] : [];
    totalUsers = await db.query(countQuery, countParams);
    const total = parseInt(totalUsers[0].count, 10);

    const users = usersData.map((u) => ({
      ...u,
      id: parseInt(u.id, 10),
      blocked: Boolean(u.blocked),
      paused: Boolean(u.paused),
      website_count: Number(u.website_count),
    }));

    const totalPages = Math.ceil(total / limit);

    res.json({
      users,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user (admin only)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *               blocked:
 *                 type: boolean
 *               paused:
 *                 type: boolean
 *               max_api_keys:
 *                 type: integer
 *               reporting_weekday:
 *                 type: string
 *                 enum: ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
 *               reporting_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Invalid request
 *       409:
 *         description: Username already exists
 */
router.post('/', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    let { username, password, roles, blocked, paused, max_api_keys, reporting_weekday, reporting_email } = req.body;
    if (!username) {
      return res.status(400).send('Username is required');
    }
    if (!password) {
      return res.status(400).send('Password is required');
    }
    if (!roles || roles.length === 0) {
      roles = [ROLE_USER];
    }
    const newUser = await user.createUser(username, password, roles, blocked, max_api_keys, reporting_weekday, reporting_email, null, null, null, paused);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).send('An account with that username already exists.');
    }
    if (err.message.includes('Password must') || err.message.includes('Username must')) {
      return res.status(400).send(err.message);
    }
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a single user by ID (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A single user object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 username:
 *                   type: string
 *                 blocked:
 *                   type: boolean
 *                 paused:
 *                   type: boolean
 *                 max_api_keys:
 *                   type: integer
 *                 reporting_weekday:
 *                   type: string
 *                 reporting_email:
 *                   type: string
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: User not found
 */
router.get('/:id', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    const account = await findAccountForResponse(req.params.id);
    if (!account) {
      return res.status(404).send('User not found');
    }
    res.json(account);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update a user (admin only)
 *     description: >
 *       Changes reporting and white-label settings and the API key limit.
 *       Any other field is a 400 naming the allowed set. Credentials and
 *       roles are CLI-only since v1.47.0 (`user:reset-password`,
 *       `user:role:add`/`remove`); block and pause have their own routes.
 *       Replies with the updated user as JSON, so the caller can read back
 *       what was stored.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               max_api_keys:
 *                 type: integer
 *               reporting_weekday:
 *                 type: string
 *                 enum: ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
 *               reporting_email:
 *                 type: string
 *                 format: email
 *               enable_white_label:
 *                 type: boolean
 *               white_label_html:
 *                 type: string
 *                 maxLength: 16384
 *     responses:
 *       200:
 *         description: The updated user, in the same shape as GET /api/users/{id}
 *       400:
 *         description: An empty body, a field outside the allowed set, or an invalid value. The body carries `error` and `message`.
 *       404:
 *         description: No user with that id
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /api/users/me:
 *   put:
 *     summary: Update current user's account settings
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reporting_weekday:
 *                 type: string
 *                 enum: ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
 *                 description: Day of week for vulnerability reports (empty string to disable)
 *               reporting_email:
 *                 type: string
 *                 format: email
 *                 description: Alternative email for reports (uses username if not provided)
 *               enable_white_label:
 *                 type: boolean
 *                 description: Enable custom branding in email reports
 *               white_label_html:
 *                 type: string
 *                 maxLength: 16384
 *                 description: Custom HTML for email report header (max 16KB, will be sanitized)
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Invalid request (a field that is not self-editable, an invalid reporting_email or reporting_weekday, or white_label_html over the limit)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/me', apiAuth, logApiCall, async (req, res) => {
  try {
    const validation = validateAccountUpdate(req.body, SELF_EDITABLE_FIELDS);
    if (validation.error) {
      return res.status(400).json(validation.error);
    }

    await user.updateUser(req.user.id, validation.updateData);
    res.send('User updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/me/password:
 *   put:
 *     summary: Update the current user's password
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password updated
 *       400:
 *         description: Invalid password
 */
router.put('/me/password', apiAuth, logApiCall, async (req, res) => {
  try {
    await user.updatePassword(req.user.id, req.body.newPassword);
    res.send('Password updated');
  } catch (err) {
    if (err.message.includes('Password must')) {
      return res.status(400).send(err.message);
    }
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.put('/:id', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    const existing = await findAccountForResponse(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found', message: `No user with id ${req.params.id}.` });
    }

    const validation = validateAccountUpdate(req.body, ADMIN_EDITABLE_FIELDS);
    if (validation.error) {
      return res.status(400).json(validation.error);
    }

    await user.updateUser(existing.id, validation.updateData);
    res.json(await findAccountForResponse(existing.id));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/me/pause:
 *   put:
 *     summary: Pause own account
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Account paused
 */
router.put('/me/pause', apiAuth, logApiCall, async (req, res) => {
  try {
    await user.updateUser(req.user.id, { paused: true });
    res.send('Account paused');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/me/unpause:
 *   put:
 *     summary: Unpause own account
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Account unpaused
 */
router.put('/me/unpause', apiAuth, logApiCall, async (req, res) => {
  try {
    await user.updateUser(req.user.id, { paused: false });
    res.send('Account unpaused');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}/pause:
 *   put:
 *     summary: Pause a user account (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User paused
 */
router.put('/:id/pause', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    await user.updateUser(req.params.id, { paused: true });
    res.send('User paused');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}/unpause:
 *   put:
 *     summary: Unpause a user account (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User unpaused
 */
router.put('/:id/unpause', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    await user.updateUser(req.params.id, { paused: false });
    res.send('User unpaused');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}/block:
 *   put:
 *     summary: Block a user account (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User blocked
 *       403:
 *         description: Cannot block own account
 */
router.put('/:id/block', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    // Prevent admin from blocking themselves
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(403).send('You cannot block your own account. This would cause a complete system lockout.');
    }
    await user.updateUser(req.params.id, { blocked: true });
    res.send('User blocked');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}/unblock:
 *   put:
 *     summary: Unblock a user account (admin only)
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User unblocked
 */
router.put('/:id/unblock', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    await user.updateUser(req.params.id, { blocked: false });
    res.send('User unblocked');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deleted
 */
router.delete('/:id', apiKeyAdminAuth, logApiCall, async (req, res) => {
  try {
    await user.deleteUser(req.params.id);
    res.send('User deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
