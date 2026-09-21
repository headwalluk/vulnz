const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { sanitizeComponentSlug } = require('../lib/sanitizer');
const { normaliseReportedVersion, MAX_VERSION_LENGTH } = require('../lib/versionCompare');
const Release = require('../models/release');
const ComponentType = require('../models/componentType');
const { ERROR_CODES, itemError, requestError } = require('../lib/apiErrors');
const logger = require('../lib/logger');

const MAX_BULK_ITEMS = 500;

/**
 * @swagger
 * tags:
 *   name: Releases
 *   description: API for managing component releases
 */

/**
 * @swagger
 * /api/releases/bulk:
 *   post:
 *     summary: Bulk-create releases across multiple components
 *     description: >
 *       Creates component and release records in bulk. Components are auto-created
 *       if they don't exist. Duplicate releases (same component + version) are
 *       counted but not treated as errors. Does not create vulnerability records.
 *     tags: [Releases]
 *     security:
 *       - apiKey: []
 *       - session: []
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
 *                   description: Number of new release records inserted
 *                 duplicates:
 *                   type: integer
 *                   description: Number of duplicate releases skipped
 *                 errors:
 *                   type: array
 *                   description: One entry per invalid item, which was skipped. Branch on code, not message.
 *                   items:
 *                     $ref: '#/components/schemas/BulkItemError'
 *       400:
 *         description: No item in the batch is valid (errors lists each one), or the items array itself is unusable (error and code)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/ErrorResponse'
 *                 - type: object
 *                   properties:
 *                     errors:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/BulkItemError'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Unexpected failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/bulk', apiAuth, logApiCall, async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json(requestError(ERROR_CODES.ITEMS_INVALID, 'items must be a non-empty array.'));
    }

    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json(requestError(ERROR_CODES.TOO_MANY_ITEMS, `Maximum ${MAX_BULK_ITEMS} items per request.`));
    }

    // Validate all items up-front before writing anything; an invalid item is skipped, not fatal
    const componentTypeSlugs = new Set((await ComponentType.findAll()).map((componentType) => componentType.slug));
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item || typeof item !== 'object') {
        errors.push(itemError(i, ERROR_CODES.ITEM_NOT_OBJECT, null, 'Each item must be an object.'));
        continue;
      }
      if (!item.componentTypeSlug || typeof item.componentTypeSlug !== 'string') {
        errors.push(itemError(i, ERROR_CODES.FIELD_REQUIRED, 'componentTypeSlug', 'componentTypeSlug is required.'));
        continue;
      }
      if (!componentTypeSlugs.has(item.componentTypeSlug)) {
        errors.push(itemError(i, ERROR_CODES.UNKNOWN_COMPONENT_TYPE, 'componentTypeSlug', `Component type not found: ${item.componentTypeSlug}`));
        continue;
      }
      if (!item.componentSlug || typeof item.componentSlug !== 'string') {
        errors.push(itemError(i, ERROR_CODES.FIELD_REQUIRED, 'componentSlug', 'componentSlug is required.'));
        continue;
      }
      if (!item.version || typeof item.version !== 'string') {
        errors.push(itemError(i, ERROR_CODES.FIELD_REQUIRED, 'version', 'version is required.'));
        continue;
      }
      if (!normaliseReportedVersion(item.version)) {
        errors.push(itemError(i, ERROR_CODES.FIELD_INVALID, 'version', `version must be 1-${MAX_VERSION_LENGTH} characters after trimming.`));
      }
    }

    const invalidIndexes = new Set(errors.map((error) => error.index));
    if (invalidIndexes.size === items.length) {
      return res.status(400).json({ errors });
    }

    // Caches to avoid redundant lookups within the same batch
    const componentCache = new Map();
    const releaseCache = new Map();

    let totalCreated = 0;
    let totalDuplicates = 0;

    for (let i = 0; i < items.length; i++) {
      if (invalidIndexes.has(i)) {
        continue;
      }
      const item = items[i];
      const componentTypeSlug = item.componentTypeSlug;
      const componentSlug = sanitizeComponentSlug(item.componentSlug);
      const version = normaliseReportedVersion(item.version);

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

      // Resolve release (cached, auto-create with duplicate tracking)
      const releaseKey = `${comp.id}:${version}`;
      if (!releaseCache.has(releaseKey)) {
        const { created } = await Release.resolve(comp.id, version);
        if (created) {
          releaseCache.set(releaseKey, 'created');
          totalCreated++;
        } else {
          releaseCache.set(releaseKey, 'existing');
          totalDuplicates++;
        }
      } else {
        // Already seen in this batch
        totalDuplicates++;
      }
    }

    const response = { created: totalCreated, duplicates: totalDuplicates };
    if (errors.length > 0) {
      response.errors = errors;
    }

    logger.info(
      `Bulk releases: ${componentCache.size} components, ${items.length} releases processed, ${totalCreated} created, ${totalDuplicates} skipped${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    );

    res.status(200).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json(requestError(ERROR_CODES.INTERNAL_ERROR, 'Server error'));
  }
});

module.exports = router;
