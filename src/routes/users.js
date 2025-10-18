const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../lib/passwordValidation');
const user = require('../models/user');
const { isAuthenticated, hasRole, apiOrSessionAuth } = require('../middleware/auth');

router.put('/password', isAuthenticated, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).send(passwordValidation.errors.join(' '));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);
    res.status(200).send('Password updated successfully.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/:id', apiOrSessionAuth, hasRole('administrator'), async (req, res) => {
  try {
    const { id } = req.params;
    const [user] = await db.query('SELECT id, username, blocked FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).send('User not found');
    }
    const rows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [id]);
    user.roles = rows.map(row => row.name);
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Retrieve a list of users
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: The page number to retrieve.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: The number of users to retrieve per page.
 *     responses:
 *       200:
 *         description: A list of users.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 */
router.get('/', apiOrSessionAuth, hasRole('administrator'), async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || parseInt(process.env.LIST_PAGE_SIZE, 10);
    const offset = (page - 1) * limit;

    const users = await db.query('SELECT id, username, blocked FROM users LIMIT ? OFFSET ?', [limit, offset]);
    const [{ total }] = await db.query('SELECT COUNT(*) as total FROM users');

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

router.post('/', apiOrSessionAuth, hasRole('administrator'), async (req, res) => {
  try {
    const { username, password, roles, blocked } = req.body;
    await user.createUser(username, password, roles, blocked);
    res.status(201).send('User created');
  } catch (err) {
    if (err.message.includes('Password must be') || err.message.includes('Username must be')) {
      res.status(400).send(err.message);
    } else {
      console.error(err);
      res.status(500).send('Server error');
    }
  }
});

router.put('/:id', apiOrSessionAuth, hasRole('administrator'), async (req, res) => {
  try {
    const { id } = req.params;
    await user.updateUser(id, req.body);
    res.status(200).send('User updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.delete('/:id', apiOrSessionAuth, hasRole('administrator'), async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
