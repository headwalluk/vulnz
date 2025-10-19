const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth, hasRole } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');

/**
 * @swagger
 * tags:
 *   name: Roles
 *   description: API for managing user roles
 */

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Retrieve a list of user roles
 *     tags: [Roles]
 *     responses:
 *       200:
 *         description: A list of user roles.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Role'
 */
router.get('/', apiOrSessionAuth, logApiCall, hasRole('administrator'), async (req, res) => {
  try {
    const roles = await db.query('SELECT * FROM roles');
    res.json(roles);
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
 *     Role:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         id:
 *           type: integer
 *           description: The role ID.
 *           readOnly: true
 *         name:
 *           type: string
 *           description: The role name.
 *       example:
 *         id: 1
 *         name: "user"
 */
