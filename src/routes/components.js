const express = require('express');
const router = express.Router();
const db = require('../db');
const { hasRole, apiOrSessionAuth, optionalApiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const {
 stripAll, isUrl, sanitizeVersion, stripNonAlphaNumeric, sanitizeSearchQuery,
} = require('../lib/sanitizer');
const { unauthenticatedSearchLimiter } = require('../middleware/rateLimit');
const component = require('../models/component');

/**
 * @swagger
 * tags:
 *   name: Components
 *   description: API for managing components
 */

/**
 * @swagger
 * /api/components/search:
 *   get:
 *     summary: Search for components
 *     tags: [Components]
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         description: The search query.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: The page number to retrieve.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: The number of components to retrieve per page.
 *     responses:
 *       200:
 *         description: A list of components that match the search query.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Component'
 */
router.get('/search', unauthenticatedSearchLimiter, optionalApiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const query = sanitizeSearchQuery(req.query.query || '');
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;

    if (!query) {
      return res.status(400).send('Search query is required.');
    }

    const components = await component.search(query, page, limit);
    res.json(components);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components:
 *   get:
 *     summary: Retrieve a list of components
 *     tags: [Components]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: The page number to retrieve.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: The number of components to retrieve per page.
 *     responses:
 *       200:
 *         description: A list of components.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Component'
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || parseInt(process.env.LIST_PAGE_SIZE, 10);
    const offset = (page - 1) * limit;

    const components = await db.query('SELECT * FROM components LIMIT ? OFFSET ?', [limit, offset]);
    const [{ total }] = await db.query('SELECT COUNT(*) as total FROM components');

    res.json({
      components: components.map(c => ({ ...c, id: parseInt(c.id, 10) })),
      total: parseInt(total, 10),
      page,
      limit,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components:
 *   post:
 *     summary: Create a new component
 *     tags: [Components]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Component'
 *     responses:
 *       201:
 *         description: The created component.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Component'
 */
router.post('/', apiOrSessionAuth, logApiCall, hasRole('administrator'), async (req, res) => {
  try {
    const { slug, component_type_slug, title, description } = req.body;
    await db.query(
      'INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)',
      [slug, component_type_slug, title, description]
    );
    res.status(201).json({ slug, component_type_slug, title, description });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components/{componentTypeSlug}/{componentSlug}/{version}:
 *   post:
 *     summary: Create a new vulnerability for a release
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: componentTypeSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component type slug
 *       - in: path
 *         name: componentSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component slug
 *       - in: path
 *         name: version
 *         schema:
 *           type: string
 *         required: true
 *         description: The release version
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: The created vulnerability.
 */
router.post('/:componentTypeSlug/:componentSlug/:version', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const version = sanitizeVersion(req.params.version);
    const { urls } = req.body;

    if (!Array.isArray(urls)) {
      return res.status(400).send('An array of URLs is required.');
    }

    for (const url of urls) {
      if (!isUrl(url)) {
        return res.status(400).send(`Invalid URL format: ${url}`);
      }
    }

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).send('Component type not found');
    }

    let component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query(
        'INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)',
        [componentSlug, componentTypeSlug, componentSlug, '']
      );
      component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    }

    let release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    if (release.length === 0) {
      await db.query(
        'INSERT INTO releases (component_id, version) VALUES (?, ?)',
        [component[0].id, version]
      );
      release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    }

    for (const url of urls) {
      await db.query(
        'INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES (?, ?)',
        [release[0].id, url]
      );
    }

    res.status(200).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components/{id}:
 *   get:
 *     summary: Get a component by ID
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The component ID
 *     responses:
 *       200:
 *         description: The component description by ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Component'
 *       404:
 *         description: The component was not found
 */
/**
 * @swagger
 * /api/components/{componentTypeSlug}/{componentSlug}/{version}:
 *   get:
 *     summary: Get a release by component type, slug, and version
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: componentTypeSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component type slug
 *       - in: path
 *         name: componentSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component slug
 *       - in: path
 *         name: version
 *         schema:
 *           type: string
 *         required: true
 *         description: The release version
 *     responses:
 *       200:
 *         description: The release.
 *       404:
 *         description: The release was not found
 */
router.get('/:componentTypeSlug/:componentSlug/:version', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const version = sanitizeVersion(req.params.version);

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).send('Component type not found');
    }

    let component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query(
        'INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)',
        [componentSlug, componentTypeSlug, componentSlug, '']
      );
      component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    }
    let release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    if (release.length === 0) {
      await db.query(
        'INSERT INTO releases (component_id, version) VALUES (?, ?)',
        [component[0].id, version]
      );
      release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    }
    const vulnerabilities = await db.query('SELECT * FROM vulnerabilities WHERE release_id = ?', [release[0].id]);
    res.json({ ...release[0], id: parseInt(release[0].id, 10), component_id: parseInt(release[0].component_id, 10), vulnerabilities: vulnerabilities.map(v => ({ ...v, id: parseInt(v.id, 10), release_id: parseInt(v.release_id, 10) })), has_vulnerabilities: vulnerabilities.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components/{componentTypeSlug}/{componentSlug}:
 *   get:
 *     summary: Get a component by type and slug
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: componentTypeSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component type slug
 *       - in: path
 *         name: componentSlug
 *         schema:
 *           type: string
 *         required: true
 *         description: The component slug
 *     responses:
 *       200:
 *         description: The component.
 *       404:
 *         description: The component was not found
 */
router.get('/:componentTypeSlug/:componentSlug', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).send('Component type not found');
    }

    let component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query(
        'INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)',
        [componentSlug, componentTypeSlug, componentSlug, '']
      );
      component = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
    }
    const releases = await db.query(`
      SELECT r.*, COUNT(v.id) > 0 AS has_vulnerabilities
      FROM releases r
      LEFT JOIN vulnerabilities v ON r.id = v.release_id
      WHERE r.component_id = ?
      GROUP BY r.id
    `, [component[0].id]);
    res.json({ ...component[0], id: parseInt(component[0].id, 10), synced_from_wporg: !!component[0].synced_from_wporg, releases: releases.map(r => ({ ...r, id: parseInt(r.id, 10), component_id: parseInt(r.component_id, 10), has_vulnerabilities: !!r.has_vulnerabilities })) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/:id', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { id } = req.params;
    const component = await db.query('SELECT * FROM components WHERE id = ?', [id]);
    if (component.length === 0) {
      return res.status(404).send('Component not found');
    }
    const releases = await db.query(`
      SELECT r.*, COUNT(v.id) > 0 AS has_vulnerabilities
      FROM releases r
      LEFT JOIN vulnerabilities v ON r.id = v.release_id
      WHERE r.component_id = ?
      GROUP BY r.id
    `, [id]);
    res.json({ ...component[0], id: parseInt(component[0].id, 10), synced_from_wporg: !!component[0].synced_from_wporg, releases: releases.map(r => ({ ...r, id: parseInt(r.id, 10), component_id: parseInt(r.component_id, 10), has_vulnerabilities: !!r.has_vulnerabilities })) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components/{id}:
 *   put:
 *     summary: Update a component by ID
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The component ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Component'
 *     responses:
 *       200:
 *         description: The component was updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Component'
 *       404:
 *         description: The component was not found
 */
router.put('/:id', apiOrSessionAuth, logApiCall, hasRole('administrator'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, url } = req.body;

    const fields = {};
    if (title) {
      fields.title = title;
    }
    if (description) {
      fields.description = description;
    }
    if (url) {
      fields.url = url;
    }

    if (Object.keys(fields).length === 0) {
      return res.status(400).send('No fields to update.');
    }

    const queryParts = [];
    const queryParams = [];
    for (const [key, value] of Object.entries(fields)) {
      queryParts.push(`${key} = ?`);
      queryParams.push(value);
    }
    queryParams.push(id);

    await db.query(
      `UPDATE components SET ${queryParts.join(', ')} WHERE id = ?`,
      queryParams
    );

    res.json({ id: parseInt(id, 10), ...fields });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/components/{id}:
 *   delete:
 *     summary: Delete a component by ID
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The component ID
 *     responses:
 *       204:
 *         description: The component was deleted
 *       404:
 *         description: The component was not found
 */
router.delete('/:id', apiOrSessionAuth, logApiCall, hasRole('administrator'), async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM components WHERE id = ?', [id]);
    res.status(204).send();
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
 *     Component:
 *       type: object
 *       required:
 *         - slug
 *         - component_type_slug
 *         - title
 *       properties:
 *         id:
 *           type: integer
 *           description: The component ID.
 *           readOnly: true
 *         slug:
 *           type: string
 *           description: The component slug.
 *         component_type_slug:
 *           type: string
 *           description: The component type slug.
 *         title:
 *           type: string
 *           description: The component title.
 *         description:
 *           type: string
 *           description: A description of the component.
 *         url:
 *           type: string
 *           description: A URL related to the component.
 *       example:
 *         id: 1
 *         slug: "example-plugin"
 *         component_type_slug: "wordpress-plugin"
 *         title: "Example Plugin"
 *         description: "An example WordPress plugin."
 */
