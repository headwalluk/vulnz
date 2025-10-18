const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      baseUrl: process.env.BASE_URL,
      exampleWpComponentSlug: process.env.EXAMPLE_WP_COMPONENT_SLUG,
      exampleWpComponentVersion: process.env.EXAMPLE_WP_COMPONENT_VERSION,
      serverMode: process.env.SERVER_MODE,
      registrationEnabled: process.env.REGISTRATION_ENABLED,
      maxApiKeysPerUser: process.env.MAX_API_KEYS_PER_USER,
    });
  } else {
    res.json({
      baseUrl: process.env.BASE_URL,
      registrationEnabled: process.env.REGISTRATION_ENABLED,
    });
  }
});

module.exports = router;
