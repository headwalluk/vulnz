const express = require('express');
const router = express.Router();
const db = require('../db');
const { optionalApiOrSessionAuth } = require('../middleware/auth');
const { unauthenticatedSearchLimiter } = require('../middleware/rateLimit');
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * tags:
 *   name: Component Types
 *   description: API for managing component types
 */

/**
 * @swagger
 * /api/component-types:
 *   get:
 *     summary: Retrieve a list of component types
 *     description: >
 *       Returns all component types with their associated ecosystem.
 *       This endpoint is publicly accessible and rate-limited for unauthenticated requests.
 *     tags: [Component Types]
 *     responses:
 *       200:
 *         description: A list of component types.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ComponentType'
 *       429:
 *         description: Too many requests (rate-limited).
 *       500:
 *         description: Server error.
 */
router.get('/', unauthenticatedSearchLimiter, optionalApiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const componentTypes = await db.query(`
      SELECT ct.slug, e.slug AS ecosystem, ct.title
      FROM component_types ct
      LEFT JOIN ecosystems e ON e.id = ct.ecosystem_id
      ORDER BY ct.slug
    `);
    res.json(componentTypes);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;

/**
 * @swagger
 * components:
 *   schemas:
 *     ComponentType:
 *       type: object
 *       required:
 *         - slug
 *         - ecosystem
 *         - title
 *       properties:
 *         slug:
 *           type: string
 *           description: The component type slug.
 *         ecosystem:
 *           type: string
 *           description: The slug of the ecosystem this component type belongs to.
 *         title:
 *           type: string
 *           description: The human-readable component type name.
 *       example:
 *         slug: "wordpress-plugin"
 *         ecosystem: "wordpress"
 *         title: "WordPress Plugin"
 */
