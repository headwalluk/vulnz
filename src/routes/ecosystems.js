const express = require('express');
const router = express.Router();
const Ecosystem = require('../models/ecosystem');
const { optionalApiOrSessionAuth } = require('../middleware/auth');
const { unauthenticatedSearchLimiter } = require('../middleware/rateLimit');

/**
 * @swagger
 * /api/ecosystems:
 *   get:
 *     summary: List supported ecosystems
 *     description: >
 *       Returns all active component ecosystems supported by the system (e.g. wordpress, npm).
 *       This endpoint is publicly accessible and rate-limited for unauthenticated requests.
 *     tags:
 *       - Ecosystems
 *     responses:
 *       200:
 *         description: List of ecosystems
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   slug:
 *                     type: string
 *                     example: npm
 *                   name:
 *                     type: string
 *                     example: npm
 *                   description:
 *                     type: string
 *                   active:
 *                     type: boolean
 *       429:
 *         description: Too many requests (rate-limited)
 *       500:
 *         description: Server error
 */
router.get('/', unauthenticatedSearchLimiter, optionalApiOrSessionAuth, async (req, res) => {
  try {
    const ecosystems = await Ecosystem.findAll();
    res.json(
      ecosystems.map((eco) => ({
        slug: eco.slug,
        name: eco.name,
        description: eco.description || null,
        active: Boolean(eco.active),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
