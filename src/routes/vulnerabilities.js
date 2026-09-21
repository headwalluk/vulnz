const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { isUrl, sanitizeComponentSlug } = require('../lib/sanitizer');
const { validateVersion } = require('../lib/versionCompare');
const ComponentType = require('../models/componentType');
const Release = require('../models/release');
const VulnerabilityRange = require('../models/vulnerabilityRange');
const { MAX_VULNERABILITY_URL_LENGTH } = require('../models/vulnerability');

const MAX_BULK_ITEMS = 500;
const MAX_RANGES_PER_ITEM = 50;

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
 *     description: |
 *       Each item names its affected releases either by one exact `version`, or by
 *       `ranges` of affected versions. Exactly one of the two is required.
 *
 *       Ranges are stored per component and matched against every known release,
 *       including releases that arrive later. A version that cannot be placed
 *       against a range (an unrecognised suffix at the boundary) is not matched.
 *       Posting a range never creates a release.
 *
 *       Each item is validated and written independently. An invalid item is
 *       reported in `errors` by its index and skipped; the rest of the batch is
 *       still written. The response is 400 only when no item is valid.
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
 *                       description: One affected release version, stored exactly as given. Must be a recognisable version (same rules as range bounds). Mutually exclusive with ranges.
 *                     ranges:
 *                       type: array
 *                       maxItems: 50
 *                       description: Affected version ranges. Mutually exclusive with version.
 *                       items:
 *                         type: object
 *                         required:
 *                           - from
 *                           - to
 *                         properties:
 *                           from:
 *                             type: string
 *                             nullable: true
 *                             description: Lower bound, or null for unbounded
 *                           fromInclusive:
 *                             type: boolean
 *                             description: Required when from is set
 *                           to:
 *                             type: string
 *                             nullable: true
 *                             description: Upper bound, or null for unbounded
 *                           toInclusive:
 *                             type: boolean
 *                             description: Required when to is set. false for a fixed-in version.
 *                     urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                         maxLength: 2048
 *                       description: Array of vulnerability reference URLs
 *           example:
 *             items:
 *               - componentTypeSlug: wordpress-plugin
 *                 componentSlug: updraftplus
 *                 urls: ['https://www.wordfence.com/threat-intel/vulnerabilities/id/946ec633-a271-4e39-9ffe-e5543b063066']
 *                 ranges:
 *                   - { from: null, to: '1.26.7', toInclusive: false }
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
 *                   description: Number of vulnerability records that already existed
 *                 rangesCreated:
 *                   type: integer
 *                   description: Number of new (url, range) records stored
 *                 rangesDuplicates:
 *                   type: integer
 *                   description: Number of (url, range) records that already existed
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
 *         description: No item in the batch is valid (per-item reasons in errors)
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

    // Validate all items up-front before writing anything
    const componentTypeSlugs = new Set((await ComponentType.findAll()).map((componentType) => componentType.slug));
    const errors = [];
    const normalisedRanges = new Map();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item || typeof item !== 'object') {
        errors.push({ index: i, message: 'Each item must be an object.' });
        continue;
      }
      if (!item.componentTypeSlug || typeof item.componentTypeSlug !== 'string') {
        errors.push({ index: i, message: 'componentTypeSlug is required.' });
        continue;
      }
      if (!componentTypeSlugs.has(item.componentTypeSlug)) {
        errors.push({ index: i, message: `Component type not found: ${item.componentTypeSlug}` });
        continue;
      }
      if (!item.componentSlug || typeof item.componentSlug !== 'string') {
        errors.push({ index: i, message: 'componentSlug is required.' });
        continue;
      }
      if (item.version !== undefined && item.ranges !== undefined) {
        errors.push({ index: i, message: 'Provide either version or ranges, not both.' });
        continue;
      }
      if (item.ranges === undefined && item.version === undefined) {
        errors.push({ index: i, message: 'version or ranges is required.' });
        continue;
      }
      if (item.version !== undefined) {
        const versionError = validateVersion(item.version, 'version');
        if (versionError) {
          errors.push({ index: i, message: versionError });
          continue;
        }
      }
      if (item.ranges !== undefined) {
        if (!Array.isArray(item.ranges) || item.ranges.length === 0 || item.ranges.length > MAX_RANGES_PER_ITEM) {
          errors.push({ index: i, message: `ranges must be an array of 1-${MAX_RANGES_PER_ITEM} ranges.` });
          continue;
        }
        const ranges = [];
        let rangeError = null;
        for (const input of item.ranges) {
          const { range, error } = VulnerabilityRange.normaliseRange(input);
          if (error) {
            rangeError = error;
            break;
          }
          ranges.push(range);
        }
        if (rangeError) {
          errors.push({ index: i, message: rangeError });
          continue;
        }
        normalisedRanges.set(i, ranges);
      }
      if (!Array.isArray(item.urls) || item.urls.length === 0) {
        errors.push({ index: i, message: 'urls must be a non-empty array.' });
        continue;
      }

      for (const url of item.urls) {
        if (!isUrl(url) || url.length > MAX_VULNERABILITY_URL_LENGTH) {
          errors.push({ index: i, message: `Invalid URL format: ${url}` });
          break;
        }
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
    let totalRangesCreated = 0;
    let totalRangesDuplicates = 0;

    for (let i = 0; i < items.length; i++) {
      if (invalidIndexes.has(i)) {
        continue;
      }
      const item = items[i];
      const componentTypeSlug = item.componentTypeSlug;
      const componentSlug = sanitizeComponentSlug(item.componentSlug);

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

      if (normalisedRanges.has(i)) {
        const result = await VulnerabilityRange.recordRanges(comp.id, item.urls, normalisedRanges.get(i));
        totalCreated += result.created;
        totalDuplicates += result.matched - result.created;
        totalRangesCreated += result.rangesCreated;
        totalRangesDuplicates += result.rangesDuplicates;
      } else {
        // Resolve release (cached, auto-create)
        const version = item.version;
        const releaseKey = `${comp.id}:${version}`;
        if (!releaseCache.has(releaseKey)) {
          const resolved = await Release.resolve(comp.id, version);
          releaseCache.set(releaseKey, resolved.release);
          totalCreated += resolved.vulnerabilitiesCreated;
        }
        const release = releaseCache.get(releaseKey);

        const placeholders = item.urls.map(() => '(?, ?)').join(', ');
        const values = item.urls.flatMap((url) => [release.id, url]);
        const result = await db.query('INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES ' + placeholders, values);
        const inserted = result.affectedRows || 0;
        totalCreated += inserted;
        totalDuplicates += item.urls.length - inserted;
      }
    }

    const response = {
      created: totalCreated,
      duplicates: totalDuplicates,
      rangesCreated: totalRangesCreated,
      rangesDuplicates: totalRangesDuplicates,
    };
    if (errors.length > 0) {
      response.errors = errors.sort((left, right) => left.index - right.index);
    }
    res.status(200).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
