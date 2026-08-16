const express = require('express');
const router = express.Router();
const db = require('../db');
const { hasRole, apiAuth, optionalApiAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const { isUrl, sanitizeVersion, sanitizeSearchQuery, sanitizeComponentSlug } = require('../lib/sanitizer');
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
 * @param {object[]} releases release rows, each with has_vulnerabilities
 */
function buildComponentResponse(componentRow, releases) {
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
    releases: releases.map((release) => ({
      ...release,
      id: parseInt(release.id, 10),
      component_id: parseInt(release.component_id, 10),
      has_vulnerabilities: !!release.has_vulnerabilities,
    })),
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
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
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
      components: components.map((component) => buildComponentResponse(component, [])),
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
router.post('/', apiAuth, logApiCall, hasRole('administrator'), async (req, res) => {
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
 *       200:
 *         description: Vulnerabilities created for the release
 *       400:
 *         description: Invalid input (urls must be an array of valid URLs)
 *       404:
 *         description: Component type not found
 */
router.post('/:componentTypeSlug/:componentSlug/:version', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
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

    let component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [componentSlug, componentTypeSlug, componentSlug, '']);
      component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    }

    let release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    if (release.length === 0) {
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component[0].id, version]);
      release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    }

    for (const url of urls) {
      await db.query('INSERT IGNORE INTO vulnerabilities (release_id, url) VALUES (?, ?)', [release[0].id, url]);
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
router.get('/:componentTypeSlug/:componentSlug/:version', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;
    const version = sanitizeVersion(req.params.version);

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).send('Component type not found');
    }

    let component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [componentSlug, componentTypeSlug, componentSlug, '']);
      component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    }
    let release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    if (release.length === 0) {
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component[0].id, version]);
      release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [component[0].id, version]);
    }
    const vulnerabilities = await db.query('SELECT * FROM vulnerabilities WHERE release_id = ?', [release[0].id]);
    res.json({
      ...release[0],
      id: parseInt(release[0].id, 10),
      component_id: parseInt(release[0].component_id, 10),
      is_malware: !!component[0].is_malware,
      malware_summary: component[0].malware_summary || null,
      malware_url: component[0].malware_url || null,
      vulnerabilities: vulnerabilities.map((v) => ({
        ...v,
        id: parseInt(v.id, 10),
        release_id: parseInt(v.release_id, 10),
      })),
      has_vulnerabilities: vulnerabilities.length > 0,
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
 *     responses:
 *       200:
 *         description: The component.
 *       404:
 *         description: The component was not found
 */
router.get('/:componentTypeSlug/:componentSlug', apiAuth, logApiCall, sanitiseComponentSlugMiddleware, async (req, res) => {
  try {
    const { componentTypeSlug, componentSlug } = req.params;

    const [componentType] = await db.query('SELECT * FROM component_types WHERE slug = ?', [componentTypeSlug]);
    if (!componentType) {
      return res.status(404).send('Component type not found');
    }

    let component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
    if (component.length === 0) {
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [componentSlug, componentTypeSlug, componentSlug, '']);
      component = await db.query(`${COMPONENT_SELECT} WHERE c.component_type_slug = ? AND c.slug = ?`, [componentTypeSlug, componentSlug]);
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
    res.json(buildComponentResponse(component[0], releases));
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
      return res.status(404).send('Component not found');
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
    res.json(buildComponentResponse(component[0], releases));
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
router.put('/:id', apiAuth, logApiCall, hasRole('administrator'), async (req, res) => {
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
router.delete('/:id', apiAuth, logApiCall, hasRole('administrator'), async (req, res) => {
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
