const express = require('express');
const router = express.Router();
const { optionalApiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Get application configuration
 *     description: Returns public configuration. Authenticated users receive additional fields such as example component info, max API keys, and roles.
 *     tags:
 *       - Config
 *     responses:
 *       200:
 *         description: Application configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 baseUrl:
 *                   type: string
 *                 registrationEnabled:
 *                   type: boolean
 *                 exampleWpComponentSlug:
 *                   type: string
 *                   description: Only returned when authenticated
 *                 exampleWpComponentVersion:
 *                   type: string
 *                   description: Only returned when authenticated
 *                 maxApiKeysPerUser:
 *                   type: integer
 *                   description: Only returned when authenticated
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Only returned when authenticated
 */
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
