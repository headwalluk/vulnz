const express = require('express');
const router = express.Router();
const user = require('../models/user');
const db = require('../db');
const { isAuthenticated, hasRole } = require('../middleware/auth');

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
 *     responses:
 *       200:
 *         description: A list of users
 */
router.get('/', hasRole('administrator'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const users = await db.query('SELECT id, username, blocked, max_api_keys FROM users LIMIT ? OFFSET ?', [limit, offset]);
    for (let u of users) {
      const roles = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [u.id]);
      u.roles = roles.map((r) => r.name);
    }

    const totalUsers = await db.query('SELECT COUNT(*) as count FROM users');
    const total = totalUsers[0].count;

    res.json({
      users,
      total,
      page,
      limit,
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
 *     summary: Create a new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *               blocked:
 *                 type: boolean
 *               max_api_keys:
 *                  type: integer
 *     responses:
 *       201:
 *         description: User created
 */
router.post('/', hasRole('administrator'), async (req, res) => {
  try {
    const { username, password, roles, blocked, max_api_keys } = req.body;
    const newUser = await user.createUser(username, password, roles, blocked, max_api_keys);
    res.status(201).json(newUser);
  } catch (err) {
    if (err.message.includes('Password must')) {
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
 *     summary: Get a single user by ID
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
 *       404:
 *         description: User not found
 */
router.get('/:id', hasRole('administrator'), async (req, res) => {
  try {
    const u = await db.query('SELECT id, username, blocked, max_api_keys FROM users WHERE id = ?', [req.params.id]);
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
 *     summary: Update a user
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
 *               password:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *               blocked:
 *                 type: boolean
 *               max_api_keys:
 *                  type: integer
 *     responses:
 *       200:
 *         description: User updated
 */
router.put('/:id', hasRole('administrator'), async (req, res) => {
  try {
    await user.updateUser(req.params.id, req.body);
    res.send('User updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users/password:
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
 */
router.put('/password', isAuthenticated, async (req, res) => {
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

module.exports = router;
