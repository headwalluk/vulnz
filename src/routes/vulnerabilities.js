const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth, hasRole } = require('../middleware/auth');
const { VULNERABILITY_WRITER_ROLES } = require('../models/role');
const { logApiCall } = require('../middleware/logApiCall');
const { isUrl, sanitizeComponentSlug } = require('../lib/sanitizer');
const { validateVersion } = require('../lib/versionCompare');
const { ERROR_CODES, itemError, requestError } = require('../lib/apiErrors');
const ComponentType = require('../models/componentType');
const Release = require('../models/release');
const VulnerabilityRange = require('../models/vulnerabilityRange');
const { MAX_VULNERABILITY_URL_LENGTH } = require('../models/vulnerability');
const Advisory = require('../models/advisory');

const MAX_BULK_ITEMS = 500;
const MAX_RANGES_PER_ITEM = 250;

/** Key for one component's range set under one URL, used to merge replaceRanges items. */
function replaceSetKey(componentTypeSlug, componentSlug, url) {
  return `${componentTypeSlug}\n${sanitizeComponentSlug(componentSlug)}\n${url}`;
}
// Anything else on an item is rejected, so a field this version does not understand is never silently dropped
const ITEM_FIELDS = ['componentTypeSlug', 'componentSlug', 'version', 'ranges', 'replaceRanges', 'urls', 'advisory'];

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
 *       Ranges are added to what is stored unless the item sets `replaceRanges`
 *       (since v1.53.0). Its ranges then become the complete set for the component
 *       under each of its URLs: other stored ranges are deleted, and so are the
 *       vulnerability rows no remaining range covers (an undecidable row is kept).
 *       Items in one request for the same component and URL are merged first, so
 *       every item for that component and URL in the batch must set it. If any
 *       item naming that component and URL is rejected, nothing is replaced for
 *       it in that request; the valid items' ranges are still added.
 *
 *       An item field this version does not know is rejected with UNKNOWN_FIELD
 *       (since v1.49.0), never silently ignored.
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
 *                       maxItems: 250
 *                       description: Affected version ranges. Mutually exclusive with version. The limit was 50 before v1.53.0.
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
 *                     replaceRanges:
 *                       type: boolean
 *                       description: >
 *                         Since v1.53.0. true when ranges is the advisory's complete set for this
 *                         component: stored ranges under these URLs that are not in it are deleted,
 *                         with the rows only they covered. Only valid with ranges.
 *                     urls:
 *                       type: array
 *                       items:
 *                         type: string
 *                         maxLength: 2048
 *                       description: Array of vulnerability reference URLs
 *                     advisory:
 *                       type: object
 *                       description: >
 *                         Optional (since v1.49.0). The advisory these URLs belong to,
 *                         with its severity. Upserted by (source, external_id):
 *                         re-posting replaces its details (send the whole advisory;
 *                         an omitted field is cleared). The item's urls and any
 *                         aliases are attached to it, and never removed, so every
 *                         vulnerability recorded under those URLs takes its severity.
 *                       required: [source, external_id]
 *                       properties:
 *                         source:
 *                           type: string
 *                           description: A slug from the advisory_sources lookup (wordfence, osv)
 *                         external_id:
 *                           type: string
 *                           maxLength: 255
 *                           description: The source's own identifier for the advisory
 *                         title:
 *                           type: string
 *                           maxLength: 512
 *                         cve:
 *                           type: string
 *                           example: CVE-2024-12345
 *                         cwe:
 *                           type: object
 *                           properties:
 *                             id:
 *                               type: integer
 *                             name:
 *                               type: string
 *                         cvss:
 *                           type: object
 *                           properties:
 *                             score:
 *                               type: number
 *                               minimum: 0
 *                               maximum: 10
 *                             rating:
 *                               type: string
 *                               enum: [critical, high, medium, low, none]
 *                               description: Case-insensitive. Stored as given even when it disagrees with the score's CVSS band.
 *                             vector:
 *                               type: string
 *                               example: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
 *                         informational:
 *                           type: boolean
 *                           description: The source's notice that this is not an exploitable vulnerability. Reads report it as rating none.
 *                         published_at:
 *                           type: string
 *                           description: ISO 8601, or YYYY-MM-DD HH:MM:SS (read as UTC)
 *                         updated_at:
 *                           type: string
 *                         aliases:
 *                           type: array
 *                           maxItems: 10
 *                           items:
 *                             type: string
 *                           description: Other URLs the advisory is known by (a CVE link alongside the source's own), linked whether or not they are posted as vulnerability URLs
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
 *                 removed:
 *                   type: integer
 *                   description: Vulnerability records deleted because a replaceRanges set no longer covers them
 *                 rangesCreated:
 *                   type: integer
 *                   description: Number of new (url, range) records stored
 *                 rangesDuplicates:
 *                   type: integer
 *                   description: Number of (url, range) records that already existed
 *                 rangesRemoved:
 *                   type: integer
 *                   description: Stored (url, range) records deleted by replaceRanges
 *                 advisoriesCreated:
 *                   type: integer
 *                   description: Advisories stored for the first time
 *                 advisoriesUpdated:
 *                   type: integer
 *                   description: Items whose advisory already existed and was refreshed
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
 *       403:
 *         description: The key's account holds neither the administrator nor the ingest role (since v1.46.0)
 *       500:
 *         description: Unexpected failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/bulk', apiAuth, logApiCall, hasRole(VULNERABILITY_WRITER_ROLES), async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json(requestError(ERROR_CODES.ITEMS_INVALID, 'items must be a non-empty array.'));
    }

    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json(requestError(ERROR_CODES.TOO_MANY_ITEMS, `Maximum ${MAX_BULK_ITEMS} items per request.`));
    }

    // Validate all items up-front before writing anything
    const componentTypeSlugs = new Set((await ComponentType.findAll()).map((componentType) => componentType.slug));
    const advisorySourceSlugs = new Set(await Advisory.findSourceSlugs());
    const errors = [];
    const normalisedRanges = new Map();
    const normalisedAdvisories = new Map();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item || typeof item !== 'object') {
        errors.push(itemError(i, ERROR_CODES.ITEM_NOT_OBJECT, null, 'Each item must be an object.'));
        continue;
      }
      const unknownField = Object.keys(item).find((field) => !ITEM_FIELDS.includes(field));
      if (unknownField) {
        errors.push(itemError(i, ERROR_CODES.UNKNOWN_FIELD, unknownField, `Unknown field ${unknownField}; allowed: ${ITEM_FIELDS.join(', ')}.`));
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
      if (item.version !== undefined && item.ranges !== undefined) {
        errors.push(itemError(i, ERROR_CODES.CONFLICTING_FIELDS, 'ranges', 'Provide either version or ranges, not both.'));
        continue;
      }
      if (item.ranges === undefined && item.version === undefined) {
        errors.push(itemError(i, ERROR_CODES.FIELD_REQUIRED, 'version', 'version or ranges is required.'));
        continue;
      }
      if (item.version !== undefined) {
        const versionError = validateVersion(item.version, 'version');
        if (versionError) {
          errors.push(itemError(i, versionError.code, 'version', versionError.message));
          continue;
        }
      }
      if (item.ranges !== undefined) {
        if (!Array.isArray(item.ranges) || item.ranges.length === 0 || item.ranges.length > MAX_RANGES_PER_ITEM) {
          errors.push(itemError(i, ERROR_CODES.FIELD_INVALID, 'ranges', `ranges must be an array of 1-${MAX_RANGES_PER_ITEM} ranges.`));
          continue;
        }
        const ranges = [];
        let rangeError = null;
        for (let rangeIndex = 0; rangeIndex < item.ranges.length; rangeIndex++) {
          const { range, error } = VulnerabilityRange.normaliseRange(item.ranges[rangeIndex]);
          if (error) {
            const rangeField = `ranges[${rangeIndex}]`;
            rangeError = itemError(i, error.code, error.field ? `${rangeField}.${error.field}` : rangeField, error.message);
            break;
          }
          ranges.push(range);
        }
        if (rangeError) {
          errors.push(rangeError);
          continue;
        }
        normalisedRanges.set(i, ranges);
      }
      if (item.replaceRanges !== undefined) {
        if (typeof item.replaceRanges !== 'boolean') {
          errors.push(itemError(i, ERROR_CODES.FIELD_INVALID, 'replaceRanges', 'replaceRanges must be a boolean.'));
          continue;
        }
        if (item.ranges === undefined) {
          errors.push(itemError(i, ERROR_CODES.CONFLICTING_FIELDS, 'replaceRanges', 'replaceRanges applies only to an item with ranges.'));
          continue;
        }
      }
      if (item.urls === undefined) {
        errors.push(itemError(i, ERROR_CODES.FIELD_REQUIRED, 'urls', 'urls must be a non-empty array.'));
        continue;
      }
      if (!Array.isArray(item.urls) || item.urls.length === 0) {
        errors.push(itemError(i, ERROR_CODES.FIELD_INVALID, 'urls', 'urls must be a non-empty array.'));
        continue;
      }

      const invalidUrlIndex = item.urls.findIndex((url) => !isUrl(url) || url.length > MAX_VULNERABILITY_URL_LENGTH);
      if (invalidUrlIndex !== -1) {
        errors.push(itemError(i, ERROR_CODES.INVALID_URL, `urls[${invalidUrlIndex}]`, `Invalid URL format: ${item.urls[invalidUrlIndex]}`));
        continue;
      }
      if (item.advisory !== undefined) {
        const { advisory, error } = Advisory.normaliseAdvisory(item.advisory);
        if (error) {
          errors.push(itemError(i, error.code, error.field, error.message));
          continue;
        }
        if (!advisorySourceSlugs.has(advisory.source)) {
          errors.push(
            itemError(i, ERROR_CODES.UNKNOWN_ADVISORY_SOURCE, 'advisory.source', `Unknown advisory source ${advisory.source}; known: ${[...advisorySourceSlugs].join(', ')}.`)
          );
          continue;
        }
        normalisedAdvisories.set(i, advisory);
      }
    }

    const invalidIndexes = new Set(errors.map((error) => error.index));
    if (invalidIndexes.size === items.length) {
      return res.status(400).json({ errors });
    }

    // Caches to avoid redundant lookups within the same batch
    const componentCache = new Map();
    const releaseCache = new Map();
    // Complete range sets by component and URL, merged across the batch and applied after every item is recorded
    const replaceSets = new Map();
    // A rejected item may hold part of a set, so its component and URLs are never replaced in this request
    const blockedReplaceKeys = new Set();
    for (const index of invalidIndexes) {
      const item = items[index];
      const namesComponent = item && typeof item === 'object' && typeof item.componentTypeSlug === 'string' && typeof item.componentSlug === 'string';
      if (namesComponent && Array.isArray(item.urls)) {
        for (const url of item.urls) {
          blockedReplaceKeys.add(replaceSetKey(item.componentTypeSlug, item.componentSlug, url));
        }
      }
    }

    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalRangesCreated = 0;
    let totalRangesDuplicates = 0;
    let totalAdvisoriesCreated = 0;
    let totalAdvisoriesUpdated = 0;
    let totalRangesRemoved = 0;
    let totalRemoved = 0;

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
        if (item.replaceRanges === true) {
          for (const url of item.urls) {
            const replaceKey = replaceSetKey(componentTypeSlug, item.componentSlug, url);
            if (blockedReplaceKeys.has(replaceKey)) {
              continue;
            }
            if (!replaceSets.has(replaceKey)) {
              replaceSets.set(replaceKey, { componentId: comp.id, url, ranges: [] });
            }
            replaceSets.get(replaceKey).ranges.push(...normalisedRanges.get(i));
          }
        }
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

      if (normalisedAdvisories.has(i)) {
        const { created } = await Advisory.upsert(normalisedAdvisories.get(i), item.urls);
        if (created) {
          totalAdvisoriesCreated++;
        } else {
          totalAdvisoriesUpdated++;
        }
      }
    }

    for (const replaceSet of replaceSets.values()) {
      const result = await VulnerabilityRange.replaceRanges(replaceSet.componentId, replaceSet.url, replaceSet.ranges);
      totalRangesRemoved += result.rangesRemoved;
      totalRemoved += result.removed;
    }

    const response = {
      created: totalCreated,
      duplicates: totalDuplicates,
      removed: totalRemoved,
      rangesCreated: totalRangesCreated,
      rangesDuplicates: totalRangesDuplicates,
      rangesRemoved: totalRangesRemoved,
      advisoriesCreated: totalAdvisoriesCreated,
      advisoriesUpdated: totalAdvisoriesUpdated,
    };
    if (errors.length > 0) {
      response.errors = errors.sort((left, right) => left.index - right.index);
    }
    res.status(200).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json(requestError(ERROR_CODES.INTERNAL_ERROR, 'Server error'));
  }
});

module.exports = router;

/**
 * @swagger
 * components:
 *   schemas:
 *     BulkItemError:
 *       type: object
 *       description: Why one item of a bulk request was rejected. The item is skipped; the rest of the batch is still written.
 *       properties:
 *         index:
 *           type: integer
 *           description: Position of the item in the request's items array
 *         code:
 *           type: string
 *           description: Stable, machine-readable reason. UNRECOGNISED_VERSION is expected for some feed data (a version VULNZ cannot parse) and is not worth retrying.
 *           enum: [ITEM_NOT_OBJECT, FIELD_REQUIRED, FIELD_INVALID, CONFLICTING_FIELDS, UNKNOWN_COMPONENT_TYPE, UNRECOGNISED_VERSION, EMPTY_RANGE, INVALID_URL, UNKNOWN_FIELD, UNKNOWN_ADVISORY_SOURCE]
 *         field:
 *           type: string
 *           nullable: true
 *           description: The offending field, e.g. version, ranges[1].to or urls[0]; null when the whole item is at fault
 *         message:
 *           type: string
 *           description: Human-readable explanation. May be reworded between releases, so never parse it.
 *       example:
 *         index: 272
 *         code: UNRECOGNISED_VERSION
 *         field: ranges[0].to
 *         message: "to is not a recognisable version: .3.1"
 *     ErrorResponse:
 *       type: object
 *       description: A request-level error.
 *       properties:
 *         error:
 *           type: string
 *           description: Human-readable explanation
 *         code:
 *           type: string
 *           enum: [ITEMS_INVALID, TOO_MANY_ITEMS, INTERNAL_ERROR]
 */
