const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth } = require('../middleware/auth');

// Get all API call logs
router.get('/', apiOrSessionAuth, async (req, res) => {
  try {
    const logs = await db.query('SELECT * FROM api_call_logs WHERE user_id = ?', [req.user.id]);
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
