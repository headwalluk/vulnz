const express = require('express');
const router = express.Router();
const db = require('../db');
const apiKey = require('../models/apiKey');
const { apiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * tags:
 *   name: API Keys
 *   description: API for managing API keys
 */

/**
 * @swagger
 * /api/api-keys:
 *   get:
 *     summary: List the current user's API keys
 *     tags: [API Keys]
 *     responses:
 *       200:
 *         description: An array of API key objects.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   api_key:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const rows = await db.query('SELECT api_key FROM api_keys WHERE user_id = ?', [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/api-keys:
 *   post:
 *     summary: Generate a new API key
 *     tags: [API Keys]
 *     responses:
 *       201:
 *         description: The new API key.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 apiKey:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Maximum number of API keys reached
 *       500:
 *         description: Server error
 */
router.post('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const [user] = await db.query('SELECT max_api_keys FROM users WHERE id = ?', [req.user.id]);
    const [keys] = await db.query('SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?', [req.user.id]);

    if (keys.count >= user.max_api_keys) {
      return res.status(403).send('You have reached the maximum number of API keys.');
    }

    const newApiKey = apiKey.generateApiKey();
    await db.query('INSERT INTO api_keys (api_key, user_id) VALUES (?, ?)', [newApiKey, req.user.id]);
    res.status(201).json({ apiKey: newApiKey });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/api-keys/{key}:
 *   delete:
 *     summary: Delete an API key
 *     tags: [API Keys]
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The API key string to delete
 *     responses:
 *       204:
 *         description: API key deleted
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.delete('/:key', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { key } = req.params;
    await db.query('DELETE FROM api_keys WHERE api_key = ? AND user_id = ?', [key, req.user.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
