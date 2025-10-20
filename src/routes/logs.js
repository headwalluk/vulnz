const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

// Get all API call logs
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
