const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth, hasRole } = require('../middleware/auth');
const { ROLE_ADMINISTRATOR } = require('../models/role');
const { resolvePagination } = require('../lib/pagination');

const DEFAULT_LOG_PAGE_SIZE = 50;
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * /api/logs:
 *   get:
 *     summary: Get API call logs
 *     description: >
 *       Administrator only (since v1.44.0). The log holds every account's
 *       username, route, query string and source IP.
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
 *         description: Items per page (default 50). Capped by API_MAX_PAGE_SIZE (default 200); a larger value is a 400.
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
 *       400:
 *         description: Invalid pagination
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not an administrator
 *       500:
 *         description: Server error
 */
router.get('/', apiAuth, logApiCall, hasRole(ROLE_ADMINISTRATOR), async (req, res) => {
  try {
    const pagination = resolvePagination(req.query, DEFAULT_LOG_PAGE_SIZE);
    if (pagination.error) {
      return res.status(400).json(pagination.error);
    }
    const { page, limit, offset } = pagination;
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
