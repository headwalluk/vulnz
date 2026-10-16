const express = require('express');
const router = express.Router();
const { apiAuth, hasRole } = require('../middleware/auth');
const { RELEASE_FEED_ROLES } = require('../models/role');
const { logApiCall } = require('../middleware/logApiCall');
const { sanitizeComponentSlug, stripAll } = require('../lib/sanitizer');
const { normaliseReportedVersion, parseVersion } = require('../lib/versionCompare');
const { booleanFlag } = require('../lib/queryParams');
const { resolvePagination } = require('../lib/pagination');
const ReleaseFeed = require('../models/releaseFeed');
const Component = require('../models/component');
const ComponentType = require('../models/componentType');
const { OUTCOMES, applyFeedSuccess } = require('../lib/releaseFeeds');
const { ERROR_CODES, itemError, requestError } = require('../lib/apiErrors');
const logger = require('../lib/logger');

const DEFAULT_PAGE_SIZE = 100;
// The fields of a feed the work list returns; internal ids and audit times stay out of the contract
const WORK_LIST_FIELDS = [
  'component_type_slug',
  'slug',
  'title',
  'feed_type',
  'feed_url',
  'params',
  'is_enabled',
  'latest_version',
  'latest_version_source',
  'last_checked_at',
  'last_success_at',
  'last_version_found',
  'consecutive_failures',
  'last_error',
];
const MAX_RESULT_ITEMS = 200;
// Anything else on an item is rejected, so a field this version does not understand is never silently dropped
const ITEM_FIELDS = ['componentTypeSlug', 'componentSlug', 'feedType', 'status', 'version', 'releaseDate', 'changelog', 'error'];
const STATUS_OK = 'ok';
const STATUS_ERROR = 'error';
const RESULT_STATUSES = [STATUS_OK, STATUS_ERROR];
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// A tag-style "v1.2.3" is stored as sites report it, "1.2.3", so it matches their release row
const TAG_PREFIX_PATTERN = /^v(?=\d)/i;

/** Whether a YYYY-MM-DD string names a real calendar date. */
const isCalendarDate = (value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return RELEASE_DATE_PATTERN.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

/**
 * Check one result item's shape, without touching the database.
 * @returns {{code: string, field: string|null, message: string}|null} null when valid
 */
function validateResultShape(item, componentTypeSlugs) {
  let problem = null;
  const unknownField = item && typeof item === 'object' ? Object.keys(item).find((field) => !ITEM_FIELDS.includes(field)) : undefined;
  const isText = (value) => typeof value === 'string' && value.trim() !== '';

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    problem = { code: ERROR_CODES.ITEM_NOT_OBJECT, field: null, message: 'Each item must be an object.' };
  } else if (unknownField) {
    problem = { code: ERROR_CODES.UNKNOWN_FIELD, field: unknownField, message: `Unknown field ${unknownField}; allowed: ${ITEM_FIELDS.join(', ')}.` };
  } else if (!isText(item.componentTypeSlug)) {
    problem = { code: ERROR_CODES.FIELD_REQUIRED, field: 'componentTypeSlug', message: 'componentTypeSlug is required.' };
  } else if (!componentTypeSlugs.has(item.componentTypeSlug)) {
    problem = { code: ERROR_CODES.UNKNOWN_COMPONENT_TYPE, field: 'componentTypeSlug', message: `Component type not found: ${item.componentTypeSlug}` };
  } else if (!isText(item.componentSlug)) {
    problem = { code: ERROR_CODES.FIELD_REQUIRED, field: 'componentSlug', message: 'componentSlug is required.' };
  } else if (!isText(item.feedType)) {
    problem = { code: ERROR_CODES.FIELD_REQUIRED, field: 'feedType', message: 'feedType is required: echo the feed_type from the work list.' };
  } else if (!RESULT_STATUSES.includes(item.status)) {
    problem = { code: ERROR_CODES.FIELD_INVALID, field: 'status', message: `status must be one of: ${RESULT_STATUSES.join(', ')}.` };
  } else if (item.status === STATUS_OK && !isText(item.version)) {
    problem = { code: ERROR_CODES.FIELD_REQUIRED, field: 'version', message: 'version is required when status is ok.' };
  } else if (item.status === STATUS_ERROR && !isText(item.error)) {
    problem = { code: ERROR_CODES.FIELD_REQUIRED, field: 'error', message: 'error is required when status is error.' };
  } else if (item.releaseDate !== undefined && item.releaseDate !== null && (typeof item.releaseDate !== 'string' || !isCalendarDate(item.releaseDate))) {
    problem = { code: ERROR_CODES.FIELD_INVALID, field: 'releaseDate', message: 'releaseDate must be a date in YYYY-MM-DD form.' };
  } else if (item.changelog !== undefined && item.changelog !== null && typeof item.changelog !== 'string') {
    problem = { code: ERROR_CODES.FIELD_INVALID, field: 'changelog', message: 'changelog must be a string.' };
  }
  return problem;
}

/**
 * Find the enabled feed an item reports on.
 * @returns {Promise<{feed: object|null, problem: {code: string, field: string|null, message: string}|null}>}
 */
async function findFeedForItem(item) {
  const label = `${item.componentTypeSlug}/${item.componentSlug}`;
  const component = await Component.findByTypeAndSlug(item.componentTypeSlug, sanitizeComponentSlug(item.componentSlug));
  const feed = component ? await ReleaseFeed.findByComponentId(parseInt(component.id, 10)) : null;
  let problem = null;
  if (!feed) {
    problem = { code: ERROR_CODES.FEED_NOT_CONFIGURED, field: 'componentSlug', message: `No release feed is configured for ${label}.` };
  } else if (!feed.is_enabled) {
    problem = { code: ERROR_CODES.FEED_DISABLED, field: 'componentSlug', message: `The release feed for ${label} is disabled.` };
  } else if (feed.feed_type !== item.feedType) {
    problem = { code: ERROR_CODES.FEED_TYPE_MISMATCH, field: 'feedType', message: `The feed for ${label} is now ${feed.feed_type}, not ${item.feedType}.` };
  }
  return { feed: problem ? null : feed, problem };
}

/**
 * @swagger
 * tags:
 *   name: Release Feeds
 *   description: Where premium components' latest versions come from (M31). For the importer.
 */

/**
 * @swagger
 * /api/release-feeds:
 *   get:
 *     summary: List configured release feeds (the importer's work list)
 *     description: >
 *       One entry per component that has a release feed, least recently checked
 *       first (never-checked feeds lead). Components published on wordpress.org
 *       normally have no feed: the in-core wordpress.org sync handles them.
 *       `params` belongs to the feed type's handler and never holds a secret.
 *     tags: [Release Feeds]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: feed_type
 *         schema:
 *           type: string
 *         description: Only feeds of this type. An unknown type is a 400, never an empty list.
 *       - in: query
 *         name: include_disabled
 *         schema:
 *           type: boolean
 *           default: false
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 100
 *     responses:
 *       200:
 *         description: A page of feeds
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 feeds:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       component_type_slug: { type: string }
 *                       slug: { type: string }
 *                       title: { type: string }
 *                       feed_type: { type: string, example: github-releases }
 *                       feed_url: { type: string, example: 'https://api.github.com/repos/headwalluk/quick-2fa/releases/latest' }
 *                       params: { type: object, nullable: true }
 *                       is_enabled: { type: boolean }
 *                       latest_version: { type: string, nullable: true }
 *                       latest_version_source: { type: string, nullable: true, description: 'Feed type that last set latest_version' }
 *                       last_checked_at: { type: string, format: date-time, nullable: true }
 *                       last_success_at: { type: string, format: date-time, nullable: true }
 *                       last_version_found: { type: string, nullable: true }
 *                       consecutive_failures: { type: integer }
 *                       last_error: { type: string, nullable: true }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 limit: { type: integer }
 *                 totalPages: { type: integer }
 *       400:
 *         description: Unknown feed_type (code UNKNOWN_FEED_TYPE), or an invalid include_disabled, page or limit
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: The key's account holds neither the administrator nor the ingest role
 */
router.get('/', apiAuth, logApiCall, hasRole(RELEASE_FEED_ROLES), async (req, res) => {
  try {
    const pagination = resolvePagination(req.query, DEFAULT_PAGE_SIZE);
    if (pagination.error) {
      return res.status(400).json(pagination.error);
    }
    const { page, limit, offset } = pagination;

    const includeDisabled = booleanFlag(req.query.include_disabled);
    if (includeDisabled === undefined) {
      return res.status(400).json(requestError(ERROR_CODES.FIELD_INVALID, 'include_disabled must be true, false, 1 or 0.'));
    }

    const feedType = req.query.feed_type ? String(req.query.feed_type) : null;
    if (feedType && !(await ReleaseFeed.typeExists(feedType))) {
      const knownTypes = (await ReleaseFeed.findTypes()).map((type) => type.slug);
      return res.status(400).json(requestError(ERROR_CODES.UNKNOWN_FEED_TYPE, `feed_type must be one of: ${knownTypes.join(', ')}`));
    }

    const filters = { feedType, includeDisabled: includeDisabled === true };
    const feeds = await ReleaseFeed.list({ ...filters, limit, offset });
    const total = await ReleaseFeed.count(filters);

    res.json({
      feeds: feeds.map((feed) => Object.fromEntries(WORK_LIST_FIELDS.map((field) => [field, feed[field]]))),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(requestError(ERROR_CODES.INTERNAL_ERROR, 'Server error'));
  }
});

/**
 * @swagger
 * /api/release-feeds/results:
 *   post:
 *     summary: Report the results of checking release feeds
 *     description: >
 *       One item per feed checked, failures included: that is how a quietly
 *       broken feed becomes visible. latest_version only ever moves forwards.
 *       A changelog and release date are stored only where the release has none.
 *       The request fails as a whole only when the body is unusable; otherwise
 *       each item is answered in items (applied) or errors (rejected). An item
 *       rejected with UNRECOGNISED_VERSION also counts as a failure for its feed.
 *     tags: [Release Feeds]
 *     security:
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [results]
 *             properties:
 *               results:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [componentTypeSlug, componentSlug, feedType, status]
 *                   properties:
 *                     componentTypeSlug: { type: string, example: wordpress-plugin }
 *                     componentSlug: { type: string, example: quick-2fa }
 *                     feedType: { type: string, description: 'The feed_type from the work list', example: github-releases }
 *                     status: { type: string, enum: [ok, error] }
 *                     version: { type: string, description: 'Required when status is ok', example: '1.6.0' }
 *                     releaseDate: { type: string, format: date, example: '2026-09-25' }
 *                     changelog: { type: string, description: 'HTML or text; sanitised and capped' }
 *                     error: { type: string, description: 'Required when status is error. Short, no secrets.' }
 *     responses:
 *       200:
 *         description: Per-item outcomes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 advanced: { type: integer }
 *                 unchanged: { type: integer }
 *                 older: { type: integer }
 *                 undecidable: { type: integer }
 *                 failures_recorded: { type: integer }
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       index: { type: integer }
 *                       outcome: { type: string, enum: [advanced, unchanged, older, undecidable, failure_recorded] }
 *                       previous_version: { type: string, nullable: true }
 *                       latest_version: { type: string, nullable: true }
 *                 errors:
 *                   type: array
 *                   description: >
 *                     Rejected items. Codes include FEED_NOT_CONFIGURED, FEED_DISABLED and
 *                     FEED_TYPE_MISMATCH (re-read the work list) and UNRECOGNISED_VERSION.
 *                   items:
 *                     $ref: '#/components/schemas/BulkItemError'
 *       400:
 *         description: results is missing, empty or longer than 200 (codes ITEMS_INVALID, TOO_MANY_ITEMS)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: The key's account holds neither the administrator nor the ingest role
 */
router.post('/results', apiAuth, logApiCall, hasRole(RELEASE_FEED_ROLES), async (req, res) => {
  try {
    const { results } = req.body || {};
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(400).json(requestError(ERROR_CODES.ITEMS_INVALID, 'results must be a non-empty array.'));
    }
    if (results.length > MAX_RESULT_ITEMS) {
      return res.status(400).json(requestError(ERROR_CODES.TOO_MANY_ITEMS, `Maximum ${MAX_RESULT_ITEMS} results per request.`));
    }

    const componentTypeSlugs = new Set((await ComponentType.findAll()).map((componentType) => componentType.slug));
    const counts = { [OUTCOMES.ADVANCED]: 0, [OUTCOMES.UNCHANGED]: 0, [OUTCOMES.OLDER]: 0, [OUTCOMES.UNDECIDABLE]: 0, [OUTCOMES.FAILURE_RECORDED]: 0 };
    const items = [];
    const errors = [];

    for (let index = 0; index < results.length; index++) {
      const item = results[index];
      const shapeProblem = validateResultShape(item, componentTypeSlugs);
      if (shapeProblem) {
        errors.push(itemError(index, shapeProblem.code, shapeProblem.field, shapeProblem.message));
        continue;
      }

      const { feed, problem } = await findFeedForItem(item);
      if (problem) {
        errors.push(itemError(index, problem.code, problem.field, problem.message));
        continue;
      }

      if (item.status === STATUS_ERROR) {
        await ReleaseFeed.recordFailure(feed.component_id, stripAll(item.error).trim());
        counts[OUTCOMES.FAILURE_RECORDED]++;
        items.push({ index, outcome: OUTCOMES.FAILURE_RECORDED });
        continue;
      }

      const version = normaliseReportedVersion(item.version.trim().replace(TAG_PREFIX_PATTERN, ''));
      if (!version || !parseVersion(version)) {
        const message = `version is not a recognisable version: ${String(item.version).substring(0, 100)}`;
        await ReleaseFeed.recordFailure(feed.component_id, message);
        errors.push(itemError(index, ERROR_CODES.UNRECOGNISED_VERSION, 'version', message));
        continue;
      }

      const applied = await applyFeedSuccess(feed, { version, releaseDate: item.releaseDate || null, changelog: item.changelog || null });
      counts[applied.outcome]++;
      items.push({ index, ...applied });
      if (applied.outcome === OUTCOMES.OLDER || applied.outcome === OUTCOMES.UNDECIDABLE) {
        logger.warn(`Release feed ${feed.component_type_slug}/${feed.slug}: ${version} is ${applied.outcome} against ${applied.previous_version}; not stored`);
      }
    }

    logger.info(`Release feed results: ${results.length} posted, ${counts[OUTCOMES.ADVANCED]} advanced, ${counts[OUTCOMES.FAILURE_RECORDED]} failures, ${errors.length} rejected`);

    res.json({
      advanced: counts[OUTCOMES.ADVANCED],
      unchanged: counts[OUTCOMES.UNCHANGED],
      older: counts[OUTCOMES.OLDER],
      undecidable: counts[OUTCOMES.UNDECIDABLE],
      failures_recorded: counts[OUTCOMES.FAILURE_RECORDED],
      items,
      errors,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(requestError(ERROR_CODES.INTERNAL_ERROR, 'Server error'));
  }
});

module.exports = router;
