const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    baseUrl: process.env.BASE_URL,
    exampleWpComponentSlug: process.env.EXAMPLE_WP_COMPONENT_SLUG,
    exampleWpComponentVersion: process.env.EXAMPLE_WP_COMPONENT_VERSION,
    serverMode: process.env.SERVER_MODE,
  });
});

module.exports = router;
