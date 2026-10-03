const db = require('../db');

const createTable = async () => {
  const query = `
        CREATE TABLE IF NOT EXISTS website_components (
            website_id BIGINT UNSIGNED NOT NULL,
            release_id BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (website_id, release_id),
            FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
            FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
        )
    `;
  await db.query(query);
};

const create = async (websiteId, releaseId) => {
  await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
};

const deleteByType = async (websiteId, componentType) => {
  const query = `
        DELETE wc FROM website_components wc
        JOIN releases r ON wc.release_id = r.id
        JOIN components c ON r.component_id = c.id
        WHERE wc.website_id = ? AND c.component_type_slug = ?
    `;
  await db.query(query, [websiteId, componentType]);
};

const getComponents = async (websiteId, componentType) => {
  const query = `
        SELECT c.slug, c.title, c.component_type_slug, r.version, v.url as vulnerability_url,
               c.is_malware, c.malware_summary, c.malware_url,
               a.first_detected_at AS malware_first_detected_at
        FROM website_components wc
        JOIN releases r ON wc.release_id = r.id
        JOIN components c ON r.component_id = c.id
        LEFT JOIN vulnerabilities v ON r.id = v.release_id
        LEFT JOIN website_malware_alerts a
          ON a.website_id = wc.website_id AND a.component_id = c.id
        WHERE wc.website_id = ? AND c.component_type_slug = ?
    `;
  const rows = await db.query(query, [websiteId, componentType]);
  const components = {};
  for (const row of rows) {
    if (!components[row.slug]) {
      components[row.slug] = {
        slug: row.slug,
        title: row.title,
        component_type_slug: row.component_type_slug,
        version: row.version,
        vulnerabilities: [],
        // Malware is reported on its own terms. has_vulnerabilities below
        // stays honest — it means recorded vulnerabilities and nothing else.
        is_malware: !!row.is_malware,
        malware_summary: row.malware_summary || null,
        malware_url: row.malware_url || null,
        // Null until the site has synced since the component was flagged:
        // detections are stamped by the ingest path, not by reads.
        malware_first_detected_at: row.malware_first_detected_at || null,
      };
    }
    if (row.vulnerability_url) {
      components[row.slug].vulnerabilities.push(row.vulnerability_url);
    }
  }

  return Object.values(components).map((c) => ({
    ...c,
    has_vulnerabilities: c.vulnerabilities.length > 0,
  }));
};

const getPlugins = async (websiteId) => {
  return getComponents(websiteId, 'wordpress-plugin');
};

const getThemes = async (websiteId) => {
  return getComponents(websiteId, 'wordpress-theme');
};

const getComponentsForChangeTracking = async (websiteId) => {
  const query = `
    SELECT 
      r.component_id,
      wc.release_id
    FROM website_components wc
    JOIN releases r ON wc.release_id = r.id
    WHERE wc.website_id = ?
  `;
  return await db.query(query, [websiteId]);
};

/**
 * Every installation of one component: one row per website and release, with the owner.
 *
 * @param {number} componentId
 * @param {object} [options]
 * @param {number|null} [options.userId]  Restrict to this owner's websites; null for every website.
 * @param {boolean|null} [options.isDev]  Only dev (true) or only live (false) websites; null for both.
 */
const findInstallsOfComponent = async (componentId, { userId = null, isDev = null } = {}) => {
  let query = `
    SELECT r.id AS release_id, r.version,
           w.id AS website_id, w.domain, w.title, w.is_ssl, w.is_dev, w.versions_last_checked_at, w.user_id,
           u.username
    FROM website_components wc
    JOIN releases r ON wc.release_id = r.id
    JOIN websites w ON wc.website_id = w.id
    JOIN users u ON w.user_id = u.id
    WHERE r.component_id = ?
  `;
  const params = [componentId];

  if (userId) {
    query += ' AND w.user_id = ?';
    params.push(userId);
  }

  if (isDev === true || isDev === false) {
    query += ' AND w.is_dev = ?';
    params.push(isDev ? 1 : 0);
  }

  query += ' ORDER BY w.domain ASC';
  return db.query(query, params);
};

/**
 * Vulnerability URLs recorded against each of the given releases.
 * @param {number[]} releaseIds
 * @returns {Promise<Map<number, string[]>>} keyed by release id
 */
const findVulnerabilityUrlsByRelease = async (releaseIds) => {
  const urlsByRelease = new Map();
  if (releaseIds.length > 0) {
    const rows = await db.query('SELECT release_id, url FROM vulnerabilities WHERE release_id IN (?) ORDER BY url ASC', [releaseIds]);
    for (const row of rows) {
      const releaseId = parseInt(row.release_id, 10);
      if (!urlsByRelease.has(releaseId)) {
        urlsByRelease.set(releaseId, []);
      }
      urlsByRelease.get(releaseId).push(row.url);
    }
  }
  return urlsByRelease;
};

/**
 * Every component installed on one website, of any type, one entry per installed release.
 * Carries latest_version, malware and wordpress.org closure detail alongside the vulnerability URLs.
 * @param {number} websiteId
 */
const getInventoryForReport = async (websiteId) => {
  const query = `
    SELECT r.id AS release_id, r.version,
           c.slug, c.title, c.component_type_slug, c.latest_version,
           c.is_malware, c.malware_summary, c.malware_url,
           c.wporg_status_slug, c.wporg_closure_reason_slug, wcr.is_security_concern,
           v.url AS vulnerability_url
    FROM website_components wc
    JOIN releases r ON wc.release_id = r.id
    JOIN components c ON r.component_id = c.id
    LEFT JOIN wporg_closure_reasons wcr ON c.wporg_closure_reason_slug = wcr.slug
    LEFT JOIN vulnerabilities v ON r.id = v.release_id
    WHERE wc.website_id = ?
    ORDER BY c.component_type_slug ASC, c.slug ASC, v.url ASC
  `;
  const rows = await db.query(query, [websiteId]);
  const components = new Map();
  for (const row of rows) {
    const releaseId = parseInt(row.release_id, 10);
    if (!components.has(releaseId)) {
      components.set(releaseId, {
        slug: row.slug,
        title: row.title,
        component_type_slug: row.component_type_slug,
        version: row.version,
        latest_version: row.latest_version || null,
        vulnerabilities: [],
        is_malware: !!row.is_malware,
        malware_summary: row.malware_summary || null,
        malware_url: row.malware_url || null,
        wporg_status: row.wporg_status_slug || null,
        wporg_closure_reason: row.wporg_closure_reason_slug || null,
        // null means the closure reason exists but nobody has classified it
        wporg_closure_is_security_concern: row.is_security_concern === null || row.is_security_concern === undefined ? null : !!row.is_security_concern,
      });
    }
    if (row.vulnerability_url) {
      components.get(releaseId).vulnerabilities.push(row.vulnerability_url);
    }
  }
  return [...components.values()].map((component) => ({ ...component, has_vulnerabilities: component.vulnerabilities.length > 0 }));
};

module.exports = {
  createTable,
  create,
  deleteByType,
  getPlugins,
  getThemes,
  getComponentsForChangeTracking,
  findInstallsOfComponent,
  findVulnerabilityUrlsByRelease,
  getInventoryForReport,
};
