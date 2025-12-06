const express = require('express');
const router = express.Router();
const Website = require('../models/website');
const User = require('../models/user');
const { apiOrSessionAuth } = require('../middleware/auth');
const Component = require('../models/component');
const Release = require('../models/release');
const WebsiteComponent = require('../models/websiteComponent');
const SecurityEvent = require('../models/securityEvent');
const SecurityEventType = require('../models/securityEventType');
const FileSecurityIssue = require('../models/fileSecurityIssue');
const { lookupIp } = require('../lib/geoip');

const getWebsiteComponents = async (website) => {
  const wordpressPlugins = await WebsiteComponent.getPlugins(website.id);
  const wordpressThemes = await WebsiteComponent.getThemes(website.id);
  return { wordpressPlugins, wordpressThemes };
};

const canAccessWebsite = async (req, res, next) => {
  const { domain } = req.params;
  const website = await Website.findByDomain(domain);

  if (!website) {
    return res.status(404).send('Website not found');
  }

  const roles = await User.getRoles(req.user.id);
  if (website.user_id !== req.user.id && !roles.includes('administrator')) {
    return res.status(401).send('Unauthorized');
  }

  req.website = website;
  next();
};

const addVulnerabilityCount = (website) => {
  const vulnerablePlugins = (website['wordpress-plugins'] || []).filter((p) => p.has_vulnerabilities).length;
  const vulnerableThemes = (website['wordpress-themes'] || []).filter((t) => t.has_vulnerabilities).length;
  website.vulnerability_count = vulnerablePlugins + vulnerableThemes;
};

const addUrl = (website) => {
  website.url = `${website.is_ssl ? 'https' : 'http'}://${website.domain}`;
};

const tidyWebsite = (website) => {
  return {
    ...website,
    id: parseInt(website.id, 10),
    user_id: parseInt(website.user_id, 10),
    is_ssl: Boolean(website.is_ssl),
    is_dev: Boolean(website.is_dev),
    meta: website.meta || {},
    wordpress_version: website.wordpress_version || null,
    php_version: website.php_version || null,
    db_server_type: website.db_server_type || 'unknown',
    db_server_version: website.db_server_version || null,
    versions_last_checked_at: website.versions_last_checked_at || null,
  };
};

/**
 * @swagger
 * /api/websites:
 *   get:
 *     summary: Retrieve a list of websites
 *     description: Retrieve a list of websites for the authenticated user. Administrators can see all websites.
 *     tags:
 *       - Websites
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
 *         description: The number of websites to retrieve per page.
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: A search query to filter websites by domain or title.
 *       - in: query
 *         name: only_vulnerable
 *         schema:
 *           type: boolean
 *         description: If true, only websites with known vulnerabilities will be returned.
 *     responses:
 *       200:
 *         description: A list of websites.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 websites:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/', apiOrSessionAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.q || null;
    const onlyVulnerable = ['true', '1'].includes(req.query.only_vulnerable);

    const roles = await User.getRoles(req.user.id);
    const isAdmin = roles.includes('administrator');

    const total = await Website.countAll(isAdmin ? null : req.user.id, search, onlyVulnerable);
    const websites = await Website.findAll(isAdmin ? null : req.user.id, limit, offset, search, onlyVulnerable);

    for (const website of websites) {
      const user = await User.findUserById(website.user_id);
      if (user) {
        website.username = user.username;
      }
      const { wordpressPlugins, wordpressThemes } = await getWebsiteComponents(website);
      website['wordpress-plugins'] = wordpressPlugins;
      website['wordpress-themes'] = wordpressThemes;
      addVulnerabilityCount(website);
      addUrl(website);
    }

    res.json({
      websites: websites.map(tidyWebsite) || [],
      total,
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
 * /api/websites/{domain}:
 *   get:
 *     summary: Retrieve a single website
 *     description: Retrieve a single website by its domain name.
 *     tags:
 *       - Websites
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website to retrieve.
 *     responses:
 *       200:
 *         description: A single website.
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.get('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    const user = await User.findUserById(req.website.user_id);
    const { wordpressPlugins, wordpressThemes } = await getWebsiteComponents(req.website);
    req.website['wordpress-plugins'] = wordpressPlugins;
    req.website['wordpress-themes'] = wordpressThemes;
    addVulnerabilityCount(req.website);
    addUrl(req.website);
    res.json({
      ...tidyWebsite(req.website),
      username: user.username,
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
 *     description: Create a new website for the authenticated user.
 *     tags:
 *       - Websites
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               domain:
 *                 type: string
 *                 required: true
 *               title:
 *                 type: string
 *               user_id:
 *                 type: integer
 *               is_dev:
 *                 type: boolean
 *               meta:
 *                 type: object
 *     responses:
 *       201:
 *         description: The created website.
 *       400:
 *         description: Bad request
 *       409:
 *         description: Conflict - website already exists
 *       500:
 *         description: Server error
 */
router.post('/', apiOrSessionAuth, async (req, res) => {
  try {
    const { domain, title, user_id, is_dev, meta } = req.body;

    if (!domain) {
      return res.status(400).send('The domain property must be specified.');
    }

    const domainRegex = /^(?!-)[A-Za-z0-9-_]+([\\-\\.]{1}[a-z0-9-_]+)*\.[A-Za-z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).send('The domain property is not a valid website hostname.');
    }

    const roles = await User.getRoles(req.user.id);
    let websiteUserId = req.user.id;

    if (roles.includes('administrator') && user_id) {
      websiteUserId = user_id;
    }

    const website = await Website.create({ user_id: websiteUserId, domain, title: title || domain, is_dev: is_dev || false, meta });

    if (roles.includes('administrator')) {
      res.status(201).json({
        ...website,
        id: parseInt(website.id, 10),
        user_id: parseInt(website.user_id, 10),
      });
    } else {
      const { ...responseWebsite } = website;
      res.status(201).json(responseWebsite);
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).send('That website has already been added.');
    }
    console.error(err);
    res.status(500).send('Server error');
  }
});

const processComponents = async (components, componentType) => {
  const releaseIds = [];
  if (Array.isArray(components)) {
    for (const { slug, version } of components) {
      const component = await Component.findOrCreate(slug, componentType, slug);
      const release = await Release.findOrCreate(component.id, version);
      releaseIds.push(release.id);
    }
  }
  return releaseIds;
};

/**
 * @swagger
 * /api/websites/{domain}:
 *   put:
 *     summary: Update a website
 *     description: Update a website's properties and associated components.
 *     tags:
 *       - Websites
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               wordpress-plugins:
 *                 type: array
 *                 items:
 *                   type: object
 *               wordpress-themes:
 *                 type: array
 *                 items:
 *                   type: object
 *               is_dev:
 *                 type: boolean
 *               meta:
 *                 type: object
 *     responses:
 *       200:
 *         description: Website updated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.put('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    const { title, 'wordpress-plugins': wordpressPlugins, 'wordpress-themes': wordpressThemes, is_dev, meta } = req.body;
    const websiteData = {};
    if (title) {
      websiteData.title = title;
    }
    if (is_dev !== undefined) {
      websiteData.is_dev = is_dev;
    }
    if (meta) {
      websiteData.meta = meta;
    }

    // Dignostics. Consider removing.
    // console.log('test');
    // console.log(websiteData);

    if (Object.keys(websiteData).length > 0) {
      await Website.update(req.params.domain, websiteData);
    }

    if (wordpressPlugins) {
      await WebsiteComponent.deleteByType(req.website.id, 'wordpress-plugin');
      const pluginReleaseIds = await processComponents(wordpressPlugins, 'wordpress-plugin');
      for (const releaseId of pluginReleaseIds) {
        await WebsiteComponent.create(req.website.id, releaseId);
      }
      await Website.touch(req.website.id);
    }

    if (wordpressThemes) {
      await WebsiteComponent.deleteByType(req.website.id, 'wordpress-theme');
      const themeReleaseIds = await processComponents(wordpressThemes, 'wordpress-theme');
      for (const releaseId of themeReleaseIds) {
        await WebsiteComponent.create(req.website.id, releaseId);
      }
      await Website.touch(req.website.id);
    }

    res.send('Website updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{domain}:
 *   delete:
 *     summary: Delete a website
 *     description: Delete a website by its domain name.
 *     tags:
 *       - Websites
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website to delete.
 *     responses:
 *       200:
 *         description: Website deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.delete('/:domain', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    await Website.remove(req.params.domain);
    res.send('Website deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{domain}/security-events:
 *   post:
 *     summary: Record security events for a website
 *     description: Record one or more security events for a website. Events include failed logins, vulnerability probes, etc.
 *     tags:
 *       - Websites
 *       - Security Events
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               events:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     event_type:
 *                       type: string
 *                       description: The slug of the event type (e.g., 'failed-login', 'brute-force')
 *                     source_ip:
 *                       type: string
 *                       description: The source IP address of the event
 *                     event_datetime:
 *                       type: string
 *                       format: date-time
 *                       description: When the event occurred (ISO 8601 format)
 *                     details:
 *                       type: object
 *                       description: Additional event-specific details (JSON)
 *     responses:
 *       201:
 *         description: Events created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 events_created:
 *                   type: integer
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.post('/:domain/security-events', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    const { events } = req.body;

    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Events array is required and must not be empty' });
    }

    // Validate and prepare events for bulk insert
    const preparedEvents = [];
    const eventTypeCache = new Map();

    for (const event of events) {
      if (!event.event_type || !event.source_ip || !event.event_datetime) {
        return res.status(400).json({ 
          error: 'Each event must have event_type, source_ip, and event_datetime' 
        });
      }

      // Look up event type (with caching to avoid repeated DB queries)
      let eventType;
      if (eventTypeCache.has(event.event_type)) {
        eventType = eventTypeCache.get(event.event_type);
      } else {
        eventType = await SecurityEventType.findBySlug(event.event_type);
        if (!eventType) {
          return res.status(400).json({ 
            error: `Unknown event type: ${event.event_type}` 
          });
        }
        if (!eventType.enabled) {
          continue; // Skip disabled event types
        }
        eventTypeCache.set(event.event_type, eventType);
      }

      // GeoIP lookup
      const { continentCode, countryCode } = lookupIp(event.source_ip);

      preparedEvents.push({
        websiteId: req.website.id,
        eventTypeId: eventType.id,
        sourceIp: event.source_ip,
        eventDatetime: event.event_datetime,
        continentCode,
        countryCode,
        details: event.details || null
      });
    }

    if (preparedEvents.length === 0) {
      return res.status(400).json({ error: 'No valid events to record' });
    }

    // Bulk insert events
    await SecurityEvent.bulkCreate(preparedEvents);

    res.status(201).json({
      success: true,
      events_created: preparedEvents.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{domain}/versions:
 *   put:
 *     summary: Update software versions for a website
 *     description: Update WordPress, PHP, and database server version information for a website.
 *     tags:
 *       - Websites
 *       - Versions
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wordpress_version:
 *                 type: string
 *                 example: "6.4.2"
 *               php_version:
 *                 type: string
 *                 example: "8.2.14"
 *               db_server_type:
 *                 type: string
 *                 enum: [mysql, mariadb, unknown]
 *                 example: "mariadb"
 *               db_server_version:
 *                 type: string
 *                 example: "10.11.6"
 *     responses:
 *       200:
 *         description: Versions updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.put('/:domain/versions', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    const { wordpress_version, php_version, db_server_type, db_server_version } = req.body;

    // Validate at least one version field is provided
    if (!wordpress_version && !php_version && !db_server_type && !db_server_version) {
      return res.status(400).json({ 
        error: 'At least one version field must be provided' 
      });
    }

    // Validate db_server_type if provided
    if (db_server_type && !['mysql', 'mariadb', 'unknown'].includes(db_server_type)) {
      return res.status(400).json({ 
        error: 'db_server_type must be one of: mysql, mariadb, unknown' 
      });
    }

    const versions = {};
    if (wordpress_version !== undefined) versions.wordpress_version = wordpress_version;
    if (php_version !== undefined) versions.php_version = php_version;
    if (db_server_type !== undefined) versions.db_server_type = db_server_type;
    if (db_server_version !== undefined) versions.db_server_version = db_server_version;

    const updated = await Website.updateVersions(req.website.id, versions);

    if (!updated) {
      return res.status(500).json({ 
        error: 'Failed to update versions' 
      });
    }

    res.json({
      success: true,
      message: 'Versions updated successfully'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/websites/{domain}/security-scan:
 *   post:
 *     summary: Submit static analysis scan results for a website
 *     description: Submit security scan results from PHP_CodeSniffer or similar tools. Automatically handles touch-based purging.
 *     tags:
 *       - Websites
 *       - Static Analysis
 *     parameters:
 *       - in: path
 *         name: domain
 *         required: true
 *         schema:
 *           type: string
 *         description: The domain name of the website.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scan_datetime:
 *                 type: string
 *                 format: date-time
 *               scanner:
 *                 type: string
 *                 example: "phpcs-wordpress-security"
 *               scanner_version:
 *                 type: string
 *                 example: "3.7.2"
 *               files:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     path:
 *                       type: string
 *                       example: "wp-content/plugins/myplugin/admin.php"
 *                     issues:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           line:
 *                             type: integer
 *                           type:
 *                             type: string
 *                           severity:
 *                             type: string
 *                             enum: [info, warning, error]
 *                           message:
 *                             type: string
 *     responses:
 *       201:
 *         description: Scan results processed successfully
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Website not found
 *       500:
 *         description: Server error
 */
router.post('/:domain/security-scan', apiOrSessionAuth, canAccessWebsite, async (req, res) => {
  try {
    const { scan_datetime, scanner, scanner_version, files } = req.body;

    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Files array is required' });
    }

    const results = {
      processed: 0,
      issues_created: 0,
      issues_updated: 0,
      issues_deleted: 0,
      summary: {
        error: 0,
        warning: 0,
        info: 0
      }
    };

    // Process each file
    for (const file of files) {
      if (!file.path) {
        continue;
      }

      results.processed++;

      if (!file.issues || file.issues.length === 0) {
        // File has zero issues - delete any existing issues for this file
        const deleted = await FileSecurityIssue.deleteByFilePath(req.website.id, file.path);
        results.issues_deleted += deleted;
      } else {
        // File has issues - upsert them
        const issues = file.issues.map(issue => ({
          websiteId: req.website.id,
          filePath: file.path,
          lineNumber: issue.line || null,
          issueType: issue.type,
          severity: issue.severity || 'warning',
          message: issue.message
        }));

        for (const issue of issues) {
          await FileSecurityIssue.upsertIssue(
            issue.websiteId,
            issue.filePath,
            issue.lineNumber,
            issue.issueType,
            issue.severity,
            issue.message
          );
          results.issues_created++;
          results.summary[issue.severity]++;
        }
      }
    }

    res.status(201).json({
      success: true,
      ...results
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
