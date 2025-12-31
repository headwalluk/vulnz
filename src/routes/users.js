const express = require('express');
const router = express.Router();
const user = require('../models/user');
const db = require('../db');
const { apiKeyOrSessionAdminAuth, apiOrSessionAuth } = require('../middleware/auth');
const { sanitizeEmailHtml } = require('../lib/htmlSanitizer');

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
 *         description: Search query
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
 *                       roles:
 *                         type: array
 *                         items:
 *                           type: string
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 */
router.get('/', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const searchQuery = req.query.q || '';

    let usersData;
    let totalUsers;
    const queryParams = [];

    let baseQuery = 'SELECT id, username, blocked, paused, max_api_keys, reporting_weekday, reporting_email, enable_white_label, white_label_html FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';

    if (searchQuery) {
      baseQuery += ' WHERE username LIKE ?';
      countQuery += ' WHERE username LIKE ?';
      queryParams.push(`%${searchQuery}%`);
    }

    baseQuery += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    usersData = await db.query(baseQuery, queryParams);

    for (let u of usersData) {
      const roles = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [u.id]);
      u.roles = roles.map((r) => r.name);
    }

    const countParams = searchQuery ? [`%${searchQuery}%`] : [];
    totalUsers = await db.query(countQuery, countParams);
    const total = parseInt(totalUsers[0].count, 10);

    const users = usersData.map((u) => ({
      ...u,
      id: parseInt(u.id, 10),
      blocked: Boolean(u.blocked),
      paused: Boolean(u.paused),
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
router.post('/', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    let { username, password, roles, blocked, paused, max_api_keys, reporting_weekday, reporting_email } = req.body;
    if (!username) {
      return res.status(400).send('Username is required');
    }
    if (!password) {
      return res.status(400).send('Password is required');
    }
    if (!roles || roles.length === 0) {
      roles = ['user'];
    }
    const newUser = await user.createUser(username, password, roles, blocked, max_api_keys, reporting_weekday, reporting_email, null, null, null, paused);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
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
router.get('/:id', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    const u = await db.query('SELECT id, username, blocked, paused, max_api_keys, reporting_weekday, reporting_email FROM users WHERE id = ?', [req.params.id]);
    if (!u || u.length === 0) {
      return res.status(404).send('User not found');
    }
    const userResult = u[0];
    const roles = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [userResult.id]);
    userResult.roles = roles.map((r) => r.name);
    res.json(userResult);
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
 *               enable_white_label:
 *                 type: boolean
 *               white_label_html:
 *                 type: string
 *                 maxLength: 16384
 *     responses:
 *       200:
 *         description: User updated
 *       400:
 *         description: Invalid request
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
 *         description: Invalid request (e.g., white_label_html exceeds limit)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/me', apiOrSessionAuth, async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Validate and sanitize white_label_html if provided
    if (updateData.white_label_html !== undefined) {
      if (typeof updateData.white_label_html !== 'string') {
        return res.status(400).send('white_label_html must be a string');
      }
      if (updateData.white_label_html.length > 16384) {
        return res.status(400).send('white_label_html must not exceed 16384 characters');
      }
      updateData.white_label_html = sanitizeEmailHtml(updateData.white_label_html);
    }

    // Validate enable_white_label if provided
    if (updateData.enable_white_label !== undefined) {
      if (typeof updateData.enable_white_label !== 'boolean') {
        return res.status(400).send('enable_white_label must be a boolean');
      }
    }

    await user.updateUser(req.user.id, updateData);
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
router.put('/me/password', apiOrSessionAuth, async (req, res) => {
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

router.put('/:id', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    const updateData = { ...req.body };

    // Validate and sanitize white_label_html if provided
    if (updateData.white_label_html !== undefined) {
      if (typeof updateData.white_label_html !== 'string') {
        return res.status(400).send('white_label_html must be a string');
      }
      if (updateData.white_label_html.length > 16384) {
        return res.status(400).send('white_label_html must not exceed 16384 characters');
      }
      updateData.white_label_html = sanitizeEmailHtml(updateData.white_label_html);
    }

    // Validate enable_white_label if provided
    if (updateData.enable_white_label !== undefined) {
      if (typeof updateData.enable_white_label !== 'boolean') {
        return res.status(400).send('enable_white_label must be a boolean');
      }
    }

    await user.updateUser(req.params.id, updateData);
    res.send('User updated');
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
router.put('/me/pause', apiOrSessionAuth, async (req, res) => {
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
router.put('/me/unpause', apiOrSessionAuth, async (req, res) => {
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
router.put('/:id/pause', apiKeyOrSessionAdminAuth, async (req, res) => {
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
router.put('/:id/unpause', apiKeyOrSessionAdminAuth, async (req, res) => {
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
router.put('/:id/block', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    // Prevent admin from blocking themselves
    if (parseInt(req.params.id, 10) === req.user.id) {
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
router.put('/:id/unblock', apiKeyOrSessionAdminAuth, async (req, res) => {
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
router.delete('/:id', apiKeyOrSessionAdminAuth, async (req, res) => {
  try {
    await user.deleteUser(req.params.id);
    res.send('User deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
