const express = require('express');
const router = express.Router();
const user = require('../models/user');
const { isAuthenticated } = require('../middleware/auth');
const { sendSummaryEmail } = require('../lib/reporting');

router.post('/summary-email', isAuthenticated, async (req, res) => {
  try {
    const userId = (req.body && req.body.user_id) || (req.user && req.user.id);
    if (!userId) {
      return res.status(400).send('user_id is required');
    }

    const userToSend = await user.findUserById(userId);
    if (!userToSend) {
      return res.status(404).send('User not found');
    }

    await sendSummaryEmail(userToSend);

    res.send('Report sent');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
