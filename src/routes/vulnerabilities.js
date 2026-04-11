const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { isUrl, sanitizeVersion, sanitizeComponentSlug } = require('../lib/sanitizer');

const MAX_BULK_ITEMS = 500;

/**
 * @swagger
 * tags:
 *   name: Vulnerabilities
 *   description: API for managing vulnerabilities
 */

/**
 * @swagger
 * /api/vulnerabilities/bulk:
 *   post:
 *     summary: Bulk-create vulnerabilities across multiple components and releases
 *     tags: [Vulnerabilities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 500
 *                 items:
 *                   type: object
 *                   required:
 *                     - componentTypeSlug
 *                     - componentSlug
 *                     - version
 *                     - urls
 *                   properties:
 *                     componentTypeSlug:
 *                       type: string
 *                       description: The component type slug (e.g. wordpress-plugin, npm-package)
 *                     componentSlug:
 *                       type: string
 *                       description: The component slug
 *                     version:
 *                       type: string
 *                       description: The release version
 *                     urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Array of vulnerability reference URLs
 *     responses:
 *       200:
 *         description: Bulk import results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 created:
 *                   type: integer
 *                   description: Number of new vulnerability records inserted
 *                 duplicates:
 *                   type: integer
 *                   description: Number of duplicate records skipped
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       index:
 *                         type: integer
 *                       message:
 *                         type: string
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
router.post('/bulk', apiAuth, logApiCall, async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array.' });
    }

    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json({ error: `Maximum ${MAX_BULK_ITEMS} items per request.` });
    }

    // Validate all items up-front before touching the database
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.componentTypeSlug || typeof item.componentTypeSlug !== 'string') {
        errors.push({ index: i, message: 'componentTypeSlug is required.' });
        continue;
      }
      if (!item.componentSlug || typeof item.componentSlug !== 'string') {
        errors.push({ index: i, message: 'componentSlug is required.' });
        continue;
      }
      if (!item.version || typeof item.version !== 'string') {
        errors.push({ index: i, message: 'version is required.' });
        continue;
      }
      if (!Array.isArray(item.urls) || item.urls.length === 0) {
        errors.push({ index: i, message: 'urls must be a non-empty array.' });
        continue;
      }

      for (const url of item.urls) {
        if (!isUrl(url)) {
          errors.push({ index: i, message: `Invalid URL format: ${url}` });
          break;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Caches to avoid redundant lookups within the same batch
    const componentTypeCache = new Map();
    const componentCache = new Map();
    const releaseCache = new Map();

    let totalCreated = 0;
    let totalDuplicates = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const componentTypeSlug = item.componentTypeSlug;
      const componentSlug = sanitizeComponentSlug(item.componentSlug);
      const version = sanitizeVersion(item.version);

      // Resolve component type (cached)
      if (!componentTypeCache.has(componentTypeSlug)) {
        const [ct] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
        componentTypeCache.set(componentTypeSlug, ct || null);
      }
      if (!componentTypeCache.get(componentTypeSlug)) {
        errors.push({ index: i, message: `Component type not found: ${componentTypeSlug}` });
        continue;
      }

      // Resolve component (cached, auto-create)
      const componentKey = `${componentTypeSlug}:${componentSlug}`;
      if (!componentCache.has(componentKey)) {
        let rows = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
        if (rows.length === 0) {
          await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [componentSlug, componentTypeSlug, componentSlug, '']);
          rows = await db.query('SELECT * FROM components WHERE component_type_slug = ? AND slug = ?', [componentTypeSlug, componentSlug]);
        }
        componentCache.set(componentKey, rows[0]);
      }
      const comp = componentCache.get(componentKey);

      // Resolve release (cached, auto-create)
      const releaseKey = `${comp.id}:${version}`;
      if (!releaseCache.has(releaseKey)) {
        let rows = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp.id, version]);
        if (rows.length === 0) {
          await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [comp.id, version]);
          rows = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp.id, version]);
        }
        releaseCache.set(releaseKey, rows[0]);
      }
      const release = releaseCache.get(releaseKey);

      // Bulk-insert vulnerabilities for this item using INSERT IGNORE
      if (item.urls.length === 1) {
        const result = await db.query('INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES (?, ?)', [release.id, item.urls[0]]);
        const inserted = result.affectedRows || 0;
        totalCreated += inserted;
        totalDuplicates += 1 - inserted;
      } else {
        const placeholders = item.urls.map(() => '(?, ?)').join(', ');
        const values = item.urls.flatMap((url) => [release.id, url]);
        const result = await db.query('INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES ' + placeholders, values);
        const inserted = result.affectedRows || 0;
        totalCreated += inserted;
        totalDuplicates += item.urls.length - inserted;
      }
    }

    const response = { created: totalCreated, duplicates: totalDuplicates };
    if (errors.length > 0) {
      response.errors = errors;
    }
    res.status(200).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
