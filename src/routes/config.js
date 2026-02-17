const express = require('express');
const router = express.Router();
const { optionalApiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

router.get('/', optionalApiOrSessionAuth, logApiCall, (req, res) => {
  if (req.isAuthenticated() || req.user) {
    res.json({
      baseUrl: process.env.BASE_URL,
      exampleWpComponentSlug: process.env.EXAMPLE_WP_COMPONENT_SLUG,
      exampleWpComponentVersion: process.env.EXAMPLE_WP_COMPONENT_VERSION,
      registrationEnabled: process.env.REGISTRATION_ENABLED === 'true',
      maxApiKeysPerUser: parseInt(process.env.MAX_API_KEYS_PER_USER, 10),
      roles: req.user.roles,
    });
  } else {
    res.json({
      baseUrl: process.env.BASE_URL,
      registrationEnabled: process.env.REGISTRATION_ENABLED === 'true',
    });
  }
});

module.exports = router;
