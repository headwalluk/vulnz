const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiOrSessionAuth } = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Websites
 *   description: API for managing websites
 */

/**
 * @swagger
 * /api/websites:
 *   get:
 *     summary: Get all websites
 *     tags: [Websites]
 *     responses:
 *       200:
 *         description: A list of websites
 */
router.get('/', apiOrSessionAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const roleRows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [req.user.id]);
    const roles = (roleRows || []).map(row => row.name);

    let websites;
    let total;
    if (roles.includes('administrator')) {
      websites = await db.query('SELECT w.*, u.username FROM websites w JOIN users u ON w.user_id = u.id LIMIT ? OFFSET ?', [limit, offset]);
      const [{ total: totalCount }] = await db.query('SELECT COUNT(*) as total FROM websites');
      total = totalCount;
    } else {
      websites = await db.query('SELECT * FROM websites WHERE user_id = ? LIMIT ? OFFSET ?', [req.user.id, limit, offset]);
      const [{ total: totalCount }] = await db.query('SELECT COUNT(*) as total FROM websites WHERE user_id = ?', [req.user.id]);
      total = totalCount;
    }

    for (const website of websites) {
        const components = await db.query(`
SELECT
	releases.id,
	releases.version,
	components.title,
	component_types.slug as type 
FROM releases
JOIN components
  ON releases.component_id = components.id
JOIN component_types
  ON components.component_type_slug = component_types.slug
JOIN website_components
  ON releases.id = website_components.release_id
WHERE website_components.website_id = ?
        `, [website.id]);
        

        website.wordpressPlugins = (components ? components.filter(c => c.type === 'wordpress-plugin') : []);
        website.wordpressThemes = (components ? components.filter(c => c.type === 'wordpress-theme') : [] );
    }

    res.json({
      websites: websites || [],
      total,
      page,
      limit
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites:
 *   post:
 *     summary: Create a new website
 *     tags: [Websites]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *               - title
 *             properties:
 *               url:
 *                 type: string
 *               title:
 *                 type: string
 *     responses:
 *       201:
 *         description: Website created
 */
router.post('/', apiOrSessionAuth, async (req, res) => {
  try {
    const { url, title, wordpressPlugins, wordpressThemes } = req.body;
    const [result] = await db.query('INSERT INTO websites (user_id, url, title) VALUES (?, ?, ?)', [req.user.id, url, title]);
    const websiteId = result.insertId;

    const components = [...(wordpressPlugins || []), ...(wordpressThemes || [])];
    for (const releaseId of components) {
        await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
    }

    res.status(201).send('Website created');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).send('That website has already been added.');
    }
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{id}:
 *   put:
 *     summary: Update a website
 *     tags: [Websites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               url:
 *                 type: string
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Website updated
 */
router.put('/:id', apiOrSessionAuth, async (req, res) => {
  try {
    const { url, title, wordpressPlugins, wordpressThemes } = req.body;
    const [roleRows] = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [req.user.id]);
    const roles = (roleRows || []).map(row => row.name);

    if (roles.includes('administrator')) {
      await db.query('UPDATE websites SET url = ?, title = ? WHERE id = ?', [url, title, req.params.id]);
    } else {
      await db.query('UPDATE websites SET url = ?, title = ? WHERE id = ? AND user_id = ?', [url, title, req.params.id, req.user.id]);
    }

    await db.query('DELETE FROM website_components WHERE website_id = ?', [req.params.id]);
    const components = [...(wordpressPlugins || []), ...(wordpressThemes || [])];
    for (const releaseId of components) {
        await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [req.params.id, releaseId]);
    }

    res.send('Website updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{id}:
 *   delete:
 *     summary: Delete a website
 *     tags: [Websites]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Website deleted
 */
router.delete('/:id', apiOrSessionAuth, async (req, res) => {
  try {
    const roleRows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [req.user.id]);
    const roles = Array.isArray(roleRows) ? roleRows.map(row => row.name) : [];

    if (roles.includes('administrator')) {
      await db.query('DELETE FROM websites WHERE id = ?', [req.params.id]);
    } else {
      await db.query('DELETE FROM websites WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    }
    res.send('Website deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
