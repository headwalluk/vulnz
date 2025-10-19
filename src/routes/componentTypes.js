const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth } = require('../middleware/auth');
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
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const componentTypes = await db.query('SELECT * FROM component_types');
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
 *         - name
 *       properties:
 *         id:
 *           type: integer
 *           description: The component type ID.
 *           readOnly: true
 *         slug:
 *           type: string
 *           description: The component type slug.
 *         name:
 *           type: string
 *           description: The component type name.
 *       example:
 *         id: 1
 *         slug: "wordpress-plugin"
 *         name: "WordPress Plugin"
 */
