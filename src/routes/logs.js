const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * /api/logs:
 *   get:
 *     summary: Get API call logs
 *     tags:
 *       - Logs
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
 *         description: Items per page (default 50)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order by timestamp (default desc)
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: Filter logs by username
 *     responses:
 *       200:
 *         description: Paginated list of API call logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = (page - 1) * limit;
    const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';
    const username = req.query.username;

    let query = 'SELECT * FROM api_call_logs';
    const params = [];

    if (username) {
      query += ' WHERE username = ?';
      params.push(username);
    }

    query += ` ORDER BY timestamp ${sort} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const logs = await db.query(query, params);

    let countQuery = 'SELECT COUNT(*) as count FROM api_call_logs';
    if (username) {
      countQuery += ' WHERE username = ?';
    }
    const total = await db.query(countQuery, username ? [username] : []);

    res.json({
      logs,
      total: total[0].count,
      page,
      limit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
