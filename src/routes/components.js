const express = require('express');
const router = express.Router();
const db = require('../db');
const { hasRole, apiAuth, optionalApiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { isUrl, sanitizeSearchQuery, sanitizeComponentSlug } = require('../lib/sanitizer');
const { normaliseReportedVersion, validateVersion } = require('../lib/versionCompare');
const { unauthenticatedSearchLimiter } = require('../middleware/rateLimit');
const { formatDateOnly } = require('../lib/dates');
const { resolvePagination } = require('../lib/pagination');
const { parseIntEnv } = require('../lib/env');
const ComponentType = require('../models/componentType');
// WPORG_STATUSES mirrors the wporg_statuses lookup; it lives on the website
// model because that is where the matching website filter is validated.
const Website = require('../models/website');
// Named componentModel rather than component: several handlers below declare
// a local `component` for the row they are working on.
const componentModel = require('../models/component');
const Release = require('../models/release');

const DEFAULT_SEARCH_PAGE_SIZE = 10;
const vulnerabilityRange = require('../models/vulnerabilityRange');
const Advisory = require('../models/advisory');
const User = require('../models/user');
const { ROLE_ADMINISTRATOR, VULNERABILITY_WRITER_ROLES } = require('../models/role');
const WebsiteComponent = require('../models/websiteComponent');
const { booleanFlag, positiveInteger } = require('../lib/queryParams');
const { versionSortCompare } = require('../lib/versionCompare');
const { MAX_VULNERABILITY_URL_LENGTH } = require('../models/vulnerability');

function sanitiseComponentSlugMiddleware(req, res, next) {
  if (req.params.componentSlug) {
    req.params.componentSlug = sanitizeComponentSlug(req.params.componentSlug);
  }
  next();
}

/**
 * Every component read path selects through this, so a component has the
 * same shape wherever it is returned.
 *
 * The join exists for `is_security_concern`, which lives on the closure
 * lookup rather than on the component. Without it a consumer has to hardcode
 * `security-issue` to know a closure matters, which silently misses every
 * other security reason wordpress.org may add — and misses the unclassified
 * ones entirely.
 */
const COMPONENT_SELECT = `
  SELECT c.*, wcr.is_security_concern AS wporg_closure_is_security_concern
  FROM components c
  LEFT JOIN wporg_closure_reasons wcr ON c.wporg_closure_reason_slug = wcr.slug
`;

/** Tri-state: true, false, or null for "nobody has classified this reason". */
const closureSecurityConcern = (raw) => (raw === null || raw === undefined ? null : !!raw);

/**
 * Shape a component row and its releases for the API.
 *
 * A malware verdict is reported only as is_malware. It does not touch
 * has_vulnerabilities, which means recorded vulnerabilities and nothing
 * else — the two are different statements about a component and were
 * briefly conflated in M14. See 15-known-malware.md §10.
 *
 * @param {object} componentRow row from the components table
 * @param {object[]|null} releases release rows, each with has_vulnerabilities; null leaves the key out
 * @param {Map<number, object>} [severityByRelease] from Advisory.severityForReleases()
 */
function buildComponentResponse(componentRow, releases, severityByRelease = new Map()) {
  // Dropped from the spread because they are re-exposed below under their
  // public names. Leaving both meant the same value arrived twice under two
  // spellings, and a consumer had no way to know which was canonical.
  const { wporg_status_slug, wporg_closure_reason_slug, ...rest } = componentRow;

  return {
    ...rest,
    id: parseInt(componentRow.id, 10),
    synced_from_wporg: !!componentRow.synced_from_wporg,
    is_malware: !!componentRow.is_malware,
    malware_summary: componentRow.malware_summary || null,
    malware_url: componentRow.malware_url || null,
    // Reported separately from is_malware, and for the same reason the two
    // malware signals are separate: "wordpress.org withdrew this" is a
    // different statement from "we believe this is malicious", and a caller
    // should be able to act on either without inferring it from the other.
    wporg_status: wporg_status_slug || null,
    wporg_closure_reason: wporg_closure_reason_slug || null,
    // null means the reason exists but nobody has classified it — not that
    // the closure is harmless. Consumers must treat null as "unassessed".
    wporg_closure_is_security_concern: closureSecurityConcern(componentRow.wporg_closure_is_security_concern),
    // A closure date has no time of day. Left as the driver's Date object it
    // would serialise to a full ISO timestamp and assert one.
    wporg_closed_at: formatDateOnly(componentRow.wporg_closed_at),
    ...(releases === null
      ? {}
      : {
          releases: releases.map((release) => {
            const severity = severityByRelease.get(parseInt(release.id, 10)) || Advisory.emptySeverity();
            return {
              ...release,
              id: parseInt(release.id, 10),
              component_id: parseInt(release.component_id, 10),
              has_vulnerabilities: !!release.has_vulnerabilities,
              max_cvss_score: severity.max_cvss_score,
              max_cvss_rating: severity.max_cvss_rating,
              unrated_vulnerabilities: severity.unrated_vulnerabilities,
            };
          }),
        }),
  };
}

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
 *         required: true
 *         schema:
 *           type: string
 *         description: The search query.
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: The page number to retrieve.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: The number of components to retrieve per page.
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by component type slug (e.g. wordpress-plugin, npm-package).
 *       - in: query
 *         name: ecosystem
 *         schema:
 *           type: string
 *         description: Filter by ecosystem slug (e.g. wordpress, npm). Returns all component types within the ecosystem.
 *     responses:
 *       200:
 *         description: A list of components that match the search query.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 components:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Component'
 *                       - type: object
 *                         properties:
 *                           component_type_title:
 *                             type: string
 *                             description: Human-readable component type name.
 *                             example: WordPress Plugin
 *                           ecosystem_slug:
 *                             type: string
 *                             nullable: true
 *                             description: The ecosystem slug.
 *                             example: wordpress
 *                           ecosystem_name:
 *                             type: string
 *                             nullable: true
 *                             description: Human-readable ecosystem name.
 *                             example: WordPress
 *                           is_malware:
 *                             type: boolean
 *                             description: >
 *                               True when this component is known malware —
 *                               every version of it, present and future.
 *                               Flagged by an administrator via the CLI; there
 *                               is no API write path for this field.
 *                             example: false
 *                           malware_summary:
 *                             type: string
 *                             nullable: true
 *                             description: One-line description of what the malware does. Null unless is_malware is true.
 *                             example: Backdoor file dropper
 *                           releases:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 version:
 *                                   type: string
 *                                 has_vulnerabilities:
 *                                   type: boolean
 *                                 vulnerabilities:
 *                                   type: array
 *                                   items:
 *                                     type: string
 *                 total:
 *                   type: integer
 *                   description: Total number of matching components across all pages.
 */
// optionalApiAuth runs before the limiter on purpose: the limiter skips
// authenticated callers, and it can only see req.user if authentication has
// already happened.
router.get('/search', optionalApiAuth, unauthenticatedSearchLimiter, logApiCall, async (req, res) => {
  try {
    const query = sanitizeSearchQuery(req.query.query || '');
    const pagination = resolvePagination(req.query, DEFAULT_SEARCH_PAGE_SIZE);
    if (pagination.error) {
      return res.status(400).json(pagination.error);
    }
    const { page, limit } = pagination;
    const type = req.query.type || undefined;
    const ecosystem = req.query.ecosystem || undefined;

    if (!query) {
      return res.status(400).send('Search query is required.');
    }

    const components = await componentModel.search(query, page, limit, { type, ecosystem });
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
 *     description: >
 *       Paginated catalogue listing, filterable by wordpress.org status.
 *       The catalogue runs to tens of thousands of rows, so the filters are
 *       what make it usable — in particular `wporg_status=closed`, which
 *       enumerates every component the directory has withdrawn without
 *       needing to know its slug in advance.
 *     tags: [Components]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: The page number to retrieve. Must be a positive integer.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: >
 *           Components per page, defaulting to LIST_PAGE_SIZE. Capped by
 *           API_MAX_PAGE_SIZE (default 200); a larger value is rejected with
 *           400 rather than silently clamped.
 *       - in: query
 *         name: wporg_status
 *         schema:
 *           type: string
 *           enum: [unknown, available, closed, absent]
 *         description: >
 *           Filter by wordpress.org directory status. `closed` means the
 *           component was published and has since been withdrawn — often
 *           because of an unpatched vulnerability, and frequently with no CVE
 *           anywhere, so it appears in no other part of this API.
 *       - in: query
 *         name: wporg_closure_reason
 *         schema:
 *           type: string
 *           example: security-issue
 *         description: >
 *           Filter by wordpress.org's own closure reason slug. Pair with
 *           wporg_status=closed. Note that filtering on `security-issue`
 *           alone will miss closures whose reason has not been classified —
 *           read wporg_closure_is_security_concern on the results, where null
 *           means unassessed rather than harmless.
 *       - in: query
 *         name: component_type
 *         schema:
 *           type: string
 *           example: wordpress-plugin
 *         description: >
 *           Filter by component type slug. An unknown value is rejected with
 *           400 rather than returning an empty list.
 *     responses:
 *       200:
 *         description: A paginated list of components.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 components:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Component'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *       400:
 *         description: Invalid pagination, or an unknown wporg_status or component_type. The body carries `error` and `message`.
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', apiAuth, logApiCall, async (req, res) => {
  try {
    const pagination = resolvePagination(req.query, parseIntEnv('LIST_PAGE_SIZE', { min: 1, default: 10 }));
    if (pagination.error) {
      return res.status(400).json(pagination.error);
    }
    const { page, limit, offset } = pagination;

    const filters = [];
    const params = [];

    // The catalogue is ~36,000 rows, so an unfiltered walk is not a viable
    // way to find anything. Enumerating withdrawn plugins is the case that
    // matters: the closure data is only actionable if you can ask which
    // components carry it without already knowing their slugs.
    const wporgStatus = req.query.wporg_status || null;
    if (wporgStatus) {
      if (!Website.WPORG_STATUSES.includes(wporgStatus)) {
        return res.status(400).json({
          error: 'Unknown wporg_status',
          message: `wporg_status must be one of: ${Website.WPORG_STATUSES.join(', ')}`,
        });
      }
      filters.push('c.wporg_status_slug = ?');
      params.push(wporgStatus);
    }

    const closureReason = req.query.wporg_closure_reason || null;
    if (closureReason) {
      // An unknown reason would return zero components, which reads as "no closures for that reason"
      const knownReasons = (await db.query('SELECT slug FROM wporg_closure_reasons ORDER BY slug')).map((row) => row.slug);
      if (!knownReasons.includes(closureReason)) {
        return res.status(400).json({
          error: 'Unknown wporg_closure_reason',
          message: `wporg_closure_reason must be one of: ${knownReasons.join(', ')}`,
        });
      }
      filters.push('c.wporg_closure_reason_slug = ?');
      params.push(closureReason);
    }

    const componentType = req.query.component_type || null;
    if (componentType) {
      const knownTypes = await ComponentType.findAll();
      const typeSlugs = knownTypes.map((type) => type.slug);
      if (!typeSlugs.includes(componentType)) {
        return res.status(400).json({
          error: 'Unknown component_type',
          message: `component_type must be one of: ${typeSlugs.join(', ')}`,
        });
      }
      filters.push('c.component_type_slug = ?');
      params.push(componentType);
    }

    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';

    const components = await db.query(`${COMPONENT_SELECT}${where} ORDER BY c.id LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [{ total }] = await db.query(`SELECT COUNT(*) as total FROM components c${where}`, params);

    const totalPages = Math.ceil(Number(total) / limit);

    res.json({
      // Shaped identically to the single-component routes. This previously
      // returned raw rows, so the same field arrived as wporg_status_slug
      // here and wporg_status there.
      // The list carries no releases; GET /api/components/{type}/{slug} has them
      components: components.map((component) => buildComponentResponse(component, null)),
      total: parseInt(total, 10),
      page,
      limit,
      totalPages,
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
router.post('/', apiAuth, logApiCall, hasRole(ROLE_ADMINISTRATOR), async (req, res) => {
  try {
    let { slug, component_type_slug, title, description } = req.body;
    if (slug) {
      slug = sanitizeComponentSlug(slug);
    }
    await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [slug, component_type_slug, title, description]);
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
 *     description: Requires the administrator or ingest role (since v1.46.0). Creates the component and release if they do not exist.
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
 *               - urls
 *             properties:
 *               urls:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of vulnerability reference URLs
 *     responses:
 *       403:
 *         description: Neither the administrator nor the ingest role
 *       200:
 *         description: Vulnerabilities created for the release
 *       400:
 *         description: Invalid input (urls must be an array of valid URLs)
 *       404:
 *         description: Component type not found
 */
router.post('/:componentTypeSlug/:componentSlug/:version', apiAuth, logApiCall, hasRole(VULNERABILITY_WRITER_ROLES), sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const version = req.params.version;
    const { urls } = req.body;

    const versionError = validateVersion(version, 'version');
    if (versionError) {
      return res.status(400).send(versionError.message);
    }

    if (!Array.isArray(urls)) {
      return res.status(400).send('An array of URLs is required.');
    }

    const invalidUrl = urls.find((url) => !isUrl(url) || url.length > MAX_VULNERABILITY_URL_LENGTH);
    if (invalidUrl !== undefined) {
      return res.status(400).send(`Invalid URL format: ${invalidUrl}`);
    }

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).json({ error: 'Component type not found', message: 'Unknown component type; see GET /api/component-types.' });
    }

    let component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [componentSlug, componentTypeSlug, componentSlug, '']);
      component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    }

    const release = await Release.findOrCreate(component[0].id, version);

    for (const url of urls) {
      await db.query('INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES (?, ?)', [release.id, url]);
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
 * Group installation rows by release, newest version first, each with its vulnerabilities and sites.
 * @param {object[]} installRows from WebsiteComponent.findInstallsOfComponent()
 * @param {Map<number, string[]>} urlsByRelease
 * @param {string|null} latestVersion
 */
function groupInstallsByVersion(installRows, urlsByRelease, latestVersion) {
  const versions = new Map();
  for (const row of installRows) {
    const releaseId = parseInt(row.release_id, 10);
    if (!versions.has(releaseId)) {
      const vulnerabilities = urlsByRelease.get(releaseId) || [];
      versions.set(releaseId, {
        version: row.version,
        is_latest: Boolean(latestVersion) && row.version === latestVersion,
        has_vulnerabilities: vulnerabilities.length > 0,
        vulnerabilities,
        site_count: 0,
        sites: [],
      });
    }
    const entry = versions.get(releaseId);
    entry.site_count++;
    entry.sites.push({
      domain: row.domain,
      title: row.title,
      url: `${row.is_ssl ? 'https' : 'http'}://${row.domain}`,
      user_id: parseInt(row.user_id, 10),
      username: row.username,
      is_dev: Boolean(row.is_dev),
      server: Website.serverFromMeta(row.meta),
      versions_last_checked_at: row.versions_last_checked_at || null,
    });
  }
  return [...versions.values()].sort((left, right) => versionSortCompare(right.version, left.version));
}

/**
 * @swagger
 * /api/components/{componentTypeSlug}/{componentSlug}/installs:
 *   get:
 *     summary: Installed versions of a component across the fleet
 *     description: >
 *       One entry per installed version, newest first, each with its recorded
 *       vulnerabilities and the websites running it. Answers "which versions
 *       of this plugin are installed, and where" without pulling each site's
 *       full inventory. Administrators see every website; other users see
 *       only their own. Unlike `GET /api/components/{type}/{slug}`, an
 *       unknown component is a 404 and is never created.
 *     tags: [Components]
 *     parameters:
 *       - in: path
 *         name: componentTypeSlug
 *         schema:
 *           type: string
 *           example: wordpress-plugin
 *         required: true
 *       - in: path
 *         name: componentSlug
 *         schema:
 *           type: string
 *         required: true
 *       - in: query
 *         name: is_dev
 *         schema:
 *           type: boolean
 *         description: "`false` counts live sites only, `true` dev sites only. Omit for both."
 *       - in: query
 *         name: vulnerable_only
 *         schema:
 *           type: boolean
 *         description: Only versions with a recorded vulnerability; site_count and version_count then count only those.
 *       - in: query
 *         name: checked_within_days
 *         schema:
 *           type: integer
 *         description: Only sites that reported their versions within this many days. Excludes sites that have never reported.
 *     responses:
 *       200:
 *         description: >
 *           `component` (identity, latest_version, malware and wordpress.org
 *           status), `site_count`, `version_count`, and `versions[]`, each with
 *           `version`, `is_latest`, `has_vulnerabilities`, `vulnerabilities`
 *           (URLs), `site_count` and `sites[]` (domain, title, url, user_id,
 *           username, is_dev, server, versions_last_checked_at). `server` is
 *           the site's self-reported meta.Server (or meta.server), or null. A
 *           component installed nowhere returns an empty `versions` array.
 *       400:
 *         description: Invalid is_dev, vulnerable_only or checked_within_days
 *       404:
 *         description: Component type or component not found
 */
router.get('/:componentTypeSlug/:componentSlug/installs', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const isDev = booleanFlag(req.query.is_dev);
    const vulnerableOnly = booleanFlag(req.query.vulnerable_only);
    const checkedWithinDays = positiveInteger(req.query.checked_within_days);
    if (isDev === undefined) {
      return res.status(400).json({ error: 'Invalid is_dev', message: 'is_dev must be true, false, 1 or 0.' });
    }
    if (vulnerableOnly === undefined) {
      return res.status(400).json({ error: 'Invalid vulnerable_only', message: 'vulnerable_only must be true, false, 1 or 0.' });
    }
    if (checkedWithinDays === undefined) {
      return res.status(400).json({ error: 'Invalid checked_within_days', message: 'checked_within_days must be a positive integer.' });
    }

    const [componentType] = await db.query('SELECT slug FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).json({ error: 'Component type not found', message: 'Unknown component type; see GET /api/component-types.' });
    }

    const [component] = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (!component) {
      return res.status(404).json({ error: 'Component not found', message: 'No such component.' });
    }

    const roles = await User.getRoles(req.user.id);
    const userId = roles.includes(ROLE_ADMINISTRATOR) ? null : req.user.id;
    const allInstallRows = await WebsiteComponent.findInstallsOfComponent(component.id, { userId, isDev, checkedWithinDays });
    const releaseIds = [...new Set(allInstallRows.map((row) => parseInt(row.release_id, 10)))];
    const urlsByRelease = await WebsiteComponent.findVulnerabilityUrlsByRelease(releaseIds);
    // vulnerable_only drops clean releases before counting, so site_count describes what is returned
    const installRows = vulnerableOnly ? allInstallRows.filter((row) => urlsByRelease.has(parseInt(row.release_id, 10))) : allInstallRows;
    const versions = groupInstallsByVersion(installRows, urlsByRelease, component.latest_version);

    res.json({
      component: {
        id: parseInt(component.id, 10),
        slug: component.slug,
        component_type_slug: component.component_type_slug,
        title: component.title,
        latest_version: component.latest_version || null,
        is_malware: !!component.is_malware,
        malware_summary: component.malware_summary || null,
        wporg_status: component.wporg_status_slug || null,
        wporg_closure_reason: component.wporg_closure_reason_slug || null,
        wporg_closure_is_security_concern: closureSecurityConcern(component.wporg_closure_is_security_concern),
      },
      site_count: new Set(installRows.map((row) => parseInt(row.website_id, 10))).size,
      version_count: versions.length,
      versions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

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
 *     description: >
 *       Read-only. An unknown component is a 404. A version of a known
 *       component that no site has reported is not recorded: it is judged
 *       against the component's stored vulnerability ranges and returned with
 *       `is_recorded: false` and `id: null`. Before v1.44.0 this route created
 *       the component and release on lookup.
 *       Severity (since v1.49.0): `max_cvss_score` and `max_cvss_rating`
 *       are the worst of the release's advisories (an informational advisory
 *       rates `none`), and `unrated_vulnerabilities` counts vulnerabilities no
 *       rated advisory accounts for. While it is above 0 the max is a lower
 *       bound: unrated never means low.
 *       `advisories[]` lists each advisory, worst first: source, external_id,
 *       title, cve, cvss_score, cvss_rating, is_informational, url.
 *     responses:
 *       200:
 *         description: The release, with `is_recorded`, `vulnerabilities`, `has_vulnerabilities`, `advisories`, `max_cvss_score`, `max_cvss_rating` and `unrated_vulnerabilities`.
 *       400:
 *         description: No usable version supplied
 *       404:
 *         description: Component type or component not found
 */
router.get('/:componentTypeSlug/:componentSlug/:version', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const version = normaliseReportedVersion(req.params.version);
    if (!version) {
      return res.status(400).send('A version is required.');
    }

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).json({ error: 'Component type not found', message: 'Unknown component type; see GET /api/component-types.' });
    }

    const [component] = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (!component) {
      return res.status(404).json({ error: 'Component not found', message: 'No such component.' });
    }
    const componentId = parseInt(component.id, 10);
    const malwareFields = {
      is_malware: !!component.is_malware,
      malware_summary: component.malware_summary || null,
      malware_url: component.malware_url || null,
    };

    const [release] = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [componentId, version]);
    if (release) {
      const vulnerabilities = await db.query('SELECT id, release_id, url FROM vulnerabilities WHERE release_id = ?', [release.id]);
      const severity = (await Advisory.severityForReleases([parseInt(release.id, 10)])).get(parseInt(release.id, 10)) || Advisory.emptySeverity();
      return res.json({
        ...release,
        id: parseInt(release.id, 10),
        component_id: componentId,
        is_recorded: true,
        ...malwareFields,
        vulnerabilities: vulnerabilities.map((v) => ({
          ...v,
          id: parseInt(v.id, 10),
          release_id: parseInt(v.release_id, 10),
        })),
        has_vulnerabilities: vulnerabilities.length > 0,
        ...severity,
      });
    }

    // A version nobody has reported is judged against the stored ranges without being written.
    const affectingUrls = await vulnerabilityRange.findAffectingUrls(componentId, version);
    res.json({
      id: null,
      component_id: componentId,
      version,
      is_recorded: false,
      ...malwareFields,
      vulnerabilities: affectingUrls.map((url) => ({ id: null, release_id: null, url })),
      has_vulnerabilities: affectingUrls.length > 0,
      ...(await Advisory.severityForUrls(affectingUrls)),
    });
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
 *     description: >
 *       Read-only. An unknown component is a 404; before v1.44.0 this route
 *       created it on lookup. Each release carries `max_cvss_score`,
 *       `max_cvss_rating` and `unrated_vulnerabilities` (since v1.49.0); the
 *       version route lists the advisories themselves.
 *     responses:
 *       200:
 *         description: The component.
 *       404:
 *         description: Component type or component not found
 */
router.get('/:componentTypeSlug/:componentSlug', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).json({ error: 'Component type not found', message: 'Unknown component type; see GET /api/component-types.' });
    }

    const component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      return res.status(404).json({ error: 'Component not found', message: 'No such component.' });
    }
    const releases = await db.query(
      `
      SELECT r.*, COUNT(v.id) > 0 AS has_vulnerabilities
      FROM releases r
      LEFT JOIN vulnerabilities v ON r.id = v.release_id
      WHERE r.component_id = ?
      GROUP BY r.id
    `,
      [component[0].id]
    );
    const severityByRelease = await Advisory.severityForReleases(releases.map((release) => parseInt(release.id, 10)));
    res.json(buildComponentResponse(component[0], releases, severityByRelease));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

router.get('/:id', apiAuth, logApiCall, async (req, res) => {
  try {
    const { id } = req.params;
    const component = await db.query(`${COMPONENT_SELECT} WHERE c.id = ?`, [id]);
    if (component.length === 0) {
      return res.status(404).json({ error: 'Component not found', message: 'No such component.' });
    }
    const releases = await db.query(
      `
      SELECT r.*, COUNT(v.id) > 0 AS has_vulnerabilities
      FROM releases r
      LEFT JOIN vulnerabilities v ON r.id = v.release_id
      WHERE r.component_id = ?
      GROUP BY r.id
    `,
      [id]
    );
    const severityByRelease = await Advisory.severityForReleases(releases.map((release) => parseInt(release.id, 10)));
    res.json(buildComponentResponse(component[0], releases, severityByRelease));
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
router.put('/:id', apiAuth, logApiCall, hasRole(ROLE_ADMINISTRATOR), async (req, res) => {
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

    await db.query(`UPDATE components SET ${queryParts.join(', ')} WHERE id = ?`, queryParams);

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
router.delete('/:id', apiAuth, logApiCall, hasRole(ROLE_ADMINISTRATOR), async (req, res) => {
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
 *         is_malware:
 *           type: boolean
 *           readOnly: true
 *           description: >
 *             True when this component is known malware — every version of it,
 *             present and future. Set by an administrator via the CLI
 *             (`vulnz component:malware:add`); there is no API write path.
 *             Independent of has_vulnerabilities, which means recorded
 *             vulnerabilities and nothing else (the two were briefly coupled
 *             in v1.34.0 and decoupled again in v1.36.0).
 *         malware_summary:
 *           type: string
 *           nullable: true
 *           readOnly: true
 *           description: One-line description of what the malware does. Null unless is_malware is true.
 *         wporg_status:
 *           type: string
 *           enum: [unknown, available, closed, absent]
 *           readOnly: true
 *           description: >
 *             What wordpress.org currently says about this slug. `available` is
 *             published; `closed` means it was published and has since been
 *             withdrawn; `absent` means the directory has never listed it (a
 *             premium plugin, an in-house build, or a fake); `unknown` means it
 *             has not been resolved yet.
 *
 *
 *             `closed` is a security signal in its own right and separate from
 *             is_malware — plugins are frequently withdrawn because of an
 *             unpatched vulnerability, and a site still running one is running
 *             something the directory pulled. Check wporg_closure_reason for why.
 *         wporg_closure_reason:
 *           type: string
 *           nullable: true
 *           readOnly: true
 *           description: >
 *             wordpress.org's own reason slug for the withdrawal, e.g.
 *             `security-issue`, `author-request`, `guideline-violation`. Null
 *             unless wporg_status is `closed`. The vocabulary belongs to
 *             wordpress.org and can grow, so treat an unrecognised value as
 *             valid rather than an error.
 *           example: security-issue
 *         wporg_closure_is_security_concern:
 *           type: boolean
 *           nullable: true
 *           readOnly: true
 *           description: >
 *             Whether the closure reason is a security concern. Tri-state:
 *             true, false, or **null meaning the reason has not been
 *             classified** — which is not the same as harmless. Prefer this
 *             to string-matching wporg_closure_reason, which misses both the
 *             unclassified reasons and any new one wordpress.org introduces.
 *             Null also when wporg_status is not `closed`.
 *           example: true
 *         wporg_closed_at:
 *           type: string
 *           format: date
 *           nullable: true
 *           readOnly: true
 *           description: The date wordpress.org withdrew the plugin. Null unless wporg_status is `closed`.
 *           example: "2024-05-17"
 *       example:
 *         id: 1
 *         slug: "example-plugin"
 *         component_type_slug: "wordpress-plugin"
 *         title: "Example Plugin"
 *         description: "An example WordPress plugin."
 *         is_malware: false
 *         malware_summary: null
 *         wporg_status: "available"
 *         wporg_closure_reason: null
 *         wporg_closure_is_security_concern: null
 *         wporg_closed_at: null
 */
