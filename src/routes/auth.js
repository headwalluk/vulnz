const express = require('express');
const router = express.Router();
const passport = require('passport');
const user = require('../models/user');
const db = require('../db');
const { isAuthenticated } = require('../middleware/auth');
const crypto = require('crypto');
const passwordResetToken = require('../models/passwordResetToken');
const emailer = require('../lib/email');

/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: API for user authentication
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
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
 *               password:
 *                 type: string
 *               roles:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: User created
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, roles } = req.body;

    if (!username || !password) {
      return res.status(400).send('Username and password are required.');
    }

    const existingUser = await user.findUserByUsername(username);
    if (existingUser) {
      return res.status(400).send('Email address is already registered');
    }

    let userRoles = roles || ['user'];
    if (process.env.SERVER_MODE === 'setup') {
      userRoles = ['user', 'administrator'];
    }
    await user.createUser(username, password, userRoles);
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

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in a user
 *     tags: [Authentication]
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
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged in
 *       401:
 *         description: Unauthorized
 */
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: info.message });
    }
    if (user.blocked) {
      return res.status(401).json({ message: 'User account is blocked.' });
    }
    req.logIn(user, (err) => {
      if (err) {
        return next(err);
      }
      return res.json({ message: 'Logged in successfully' });
    });
  })(req, res, next);
});

/**
 * @swagger
 * /api/auth/logout:
 *   get:
 *     summary: Log out a user
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logged out
 */
router.get('/logout', (req, res) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.send('Logged out');
  });
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the current user's data
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: The current user's data
 *       401:
 *         description: Unauthorized
 */
router.get('/me', async (req, res) => {
  if (!req.user) {
    return res.json(null);
  }

  try {
    const rows = await db.query(
      'SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?',
      [req.user.id]
    );
    const roles = rows.map(row => row.name);
    res.json({
      id: req.user.id,
      username: req.user.username,
      roles: roles
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    // The user model does not have an email field, so we will use the username field for lookup.
    const userToReset = await user.findUserByUsername(email);

    if (!userToReset || userToReset.blocked) {
      // To prevent user enumeration, we send a success message even if the user doesn't exist or is blocked.
      return res.status(200).send('If an account with that email exists, a password reset link has been sent.');
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    
    await passwordResetToken.deleteTokensByUserId(userToReset.id);
    await passwordResetToken.createToken(userToReset.id, resetToken);

    await emailer.sendPasswordResetEmail(userToReset.username, resetToken);

    res.status(200).send('If an account with that email exists, a password reset link has been sent.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.post('/update-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).send('Token and new password are required.');
    }

    const tokenRecord = await passwordResetToken.findToken(token);

    if (!tokenRecord) {
      return res.status(400).send('Invalid or expired token.');
    }

    // The token is valid, so update the user's password
    await user.updatePassword(tokenRecord.user_id, newPassword);

    // Delete the token so it can't be used again
    await passwordResetToken.deleteTokensByUserId(tokenRecord.user_id);

    res.status(200).send('Password updated successfully.');
  } catch (err) {
    if (err.message.includes('Password must')) {
      return res.status(400).send(err.message);
    }
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/validate-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const tokenRecord = await passwordResetToken.findToken(token);

    if (!tokenRecord) {
      return res.status(404).send('Token not found or has expired.');
    }

    // Check if the token has expired based on the PASSWORD_RESET_TOKEN_DURATION
    const tokenAge = Date.now() - new Date(tokenRecord.created_at).getTime();
    const tokenExpiry = process.env.PASSWORD_RESET_TOKEN_DURATION * 1000;

    if (tokenAge > tokenExpiry) {
        return res.status(400).send('Token has expired.');
    }

    res.status(200).send('Token is valid.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
