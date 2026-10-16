const db = require('../db');

/**
 * Component release feeds (M31): where a component's latest version comes from when
 * wordpress.org does not publish it. Tables are created by migration 20261016120000.
 */

// The wordpress.org sync's value for components.latest_version_source, and a feed type for slug overrides
const FEED_TYPE_WORDPRESSORG = 'wordpressorg';
// Lengths of component_release_feeds.feed_url and .last_error
const FEED_URL_MAX_LENGTH = 2048;
const FEED_ERROR_MAX_LENGTH = 1024;

const FEED_SELECT = `
  SELECT f.component_id, c.component_type_slug, c.slug, c.title,
         f.feed_type_slug, f.feed_url, f.params, f.is_enabled,
         c.latest_version, c.latest_version_source, c.wporg_status_slug,
         f.last_checked_at, f.last_success_at, f.last_version_found,
         f.consecutive_failures, f.last_error, f.created_at, f.updated_at
  FROM component_release_feeds f
  JOIN components c ON c.id = f.component_id
`;

/** Shape a feed row for callers: integers, booleans, and params parsed from JSON. */
const formatFeed = (row) => ({
  component_id: parseInt(row.component_id, 10),
  component_type_slug: row.component_type_slug,
  slug: row.slug,
  title: row.title,
  feed_type: row.feed_type_slug,
  feed_url: row.feed_url,
  // MariaDB stores JSON as text, so the driver hands it back as a string
  params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params || null,
  is_enabled: !!row.is_enabled,
  latest_version: row.latest_version || null,
  latest_version_source: row.latest_version_source || null,
  wporg_status: row.wporg_status_slug || null,
  last_checked_at: row.last_checked_at || null,
  last_success_at: row.last_success_at || null,
  last_version_found: row.last_version_found || null,
  consecutive_failures: parseInt(row.consecutive_failures, 10),
  last_error: row.last_error || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

/** Every feed type, ordered by slug. */
const findTypes = async () => db.query('SELECT slug, title FROM release_feed_types ORDER BY slug');

/** Whether a feed type exists. */
const typeExists = async (slug) => {
  const rows = await db.query('SELECT slug FROM release_feed_types WHERE slug = ?', [slug]);
  return rows.length > 0;
};

/**
 * Add a feed type.
 * @returns {Promise<boolean>} true when the type is new
 */
const addType = async (slug, title) => {
  const result = await db.query('INSERT IGNORE INTO release_feed_types (slug, title) VALUES (?, ?)', [slug, title]);
  return (result.affectedRows || 0) > 0;
};

/** The feed for one component, or null. */
const findByComponentId = async (componentId) => {
  const rows = await db.query(`${FEED_SELECT} WHERE f.component_id = ?`, [componentId]);
  return rows.length > 0 ? formatFeed(rows[0]) : null;
};

/** Build the WHERE clause shared by list() and count(). */
const listFilter = ({ feedType = null, includeDisabled = false, failingOnly = false, disabledOnly = false } = {}) => {
  const conditions = [];
  const params = [];
  if (feedType) {
    conditions.push('f.feed_type_slug = ?');
    params.push(feedType);
  }
  if (disabledOnly) {
    conditions.push('f.is_enabled = 0');
  } else if (!includeDisabled) {
    conditions.push('f.is_enabled = 1');
  }
  if (failingOnly) {
    conditions.push('f.consecutive_failures > 0');
  }
  return { where: conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '', params };
};

/**
 * Feeds, least recently checked first (never-checked feeds lead, as NULL sorts first).
 * @param {{feedType?: string, includeDisabled?: boolean, failingOnly?: boolean, disabledOnly?: boolean, limit?: number|null, offset?: number}} options
 */
const list = async (options = {}) => {
  const { where, params } = listFilter(options);
  const paging = options.limit ? ' LIMIT ? OFFSET ?' : '';
  const pagingParams = options.limit ? [options.limit, options.offset || 0] : [];
  const rows = await db.query(`${FEED_SELECT}${where} ORDER BY f.last_checked_at ASC, f.component_id ASC${paging}`, [...params, ...pagingParams]);
  return rows.map(formatFeed);
};

/** Number of feeds matching the same filters as list(). */
const count = async (options = {}) => {
  const { where, params } = listFilter(options);
  const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM component_release_feeds f${where}`, params);
  return parseInt(total, 10);
};

/**
 * Create or replace a component's feed. A change of type or URL clears the status columns,
 * since they describe the old source.
 * @returns {Promise<{created: boolean, statusReset: boolean}>}
 */
const save = async (componentId, { feedType, feedUrl, params = null }) => {
  const paramsJson = params === null ? null : JSON.stringify(params);
  const existing = await findByComponentId(componentId);
  let created = false;
  let statusReset = false;
  if (!existing) {
    await db.query('INSERT INTO component_release_feeds (component_id, feed_type_slug, feed_url, params) VALUES (?, ?, ?, ?)', [componentId, feedType, feedUrl, paramsJson]);
    created = true;
  } else {
    statusReset = existing.feed_type !== feedType || existing.feed_url !== feedUrl;
    const statusClear = statusReset ? ', last_checked_at = NULL, last_success_at = NULL, last_version_found = NULL, consecutive_failures = 0, last_error = NULL' : '';
    await db.query(`UPDATE component_release_feeds SET feed_type_slug = ?, feed_url = ?, params = ?, updated_at = CURRENT_TIMESTAMP${statusClear} WHERE component_id = ?`, [
      feedType,
      feedUrl,
      paramsJson,
      componentId,
    ]);
  }
  return { created, statusReset };
};

/**
 * Enable or disable a component's feed.
 * @returns {Promise<boolean>} true when a feed exists
 */
const setEnabled = async (componentId, isEnabled) => {
  const result = await db.query('UPDATE component_release_feeds SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE component_id = ?', [isEnabled ? 1 : 0, componentId]);
  return (result.affectedRows || 0) > 0;
};

/**
 * Delete a component's feed; latest_version is left as it is.
 * @returns {Promise<boolean>} true when a feed existed
 */
const remove = async (componentId) => {
  const result = await db.query('DELETE FROM component_release_feeds WHERE component_id = ?', [componentId]);
  return (result.affectedRows || 0) > 0;
};

/** Record a failed check against a feed. */
const recordFailure = async (componentId, errorMessage) => {
  await db.query('UPDATE component_release_feeds SET last_checked_at = CURRENT_TIMESTAMP, consecutive_failures = consecutive_failures + 1, last_error = ? WHERE component_id = ?', [
    errorMessage.substring(0, FEED_ERROR_MAX_LENGTH),
    componentId,
  ]);
};

/** Record a successful check against a feed. */
const recordSuccess = async (componentId, version) => {
  await db.query(
    'UPDATE component_release_feeds SET last_checked_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP, last_version_found = ?, consecutive_failures = 0, last_error = NULL WHERE component_id = ?',
    [version, componentId]
  );
};

/**
 * Plugins wordpress.org does not list, installed on at least `minSites` non-dev sites.
 * Returns counts and reported versions only: no domains or account details.
 * @param {{componentType: string, minSites: number, includeFed: boolean, limit: number}} options
 */
const findCandidates = async ({ componentType, minSites, includeFed, limit }) => {
  const rows = await db.query(
    `SELECT c.id, c.slug, c.title, c.wporg_status_slug, c.latest_version, c.latest_version_source,
            f.feed_type_slug,
            COUNT(DISTINCT w.id) AS site_count,
            COUNT(DISTINCT w.user_id) AS owner_count,
            GROUP_CONCAT(DISTINCT r.version) AS versions
     FROM components c
     JOIN releases r ON r.component_id = c.id
     JOIN website_components wc ON wc.release_id = r.id
     JOIN websites w ON w.id = wc.website_id
     LEFT JOIN component_release_feeds f ON f.component_id = c.id
     WHERE c.component_type_slug = ?
       AND c.wporg_available = 0
       AND w.is_dev = 0
       ${includeFed ? '' : 'AND f.component_id IS NULL'}
     GROUP BY c.id, c.slug, c.title, c.wporg_status_slug, c.latest_version, c.latest_version_source, f.feed_type_slug
     HAVING COUNT(DISTINCT w.id) >= ?
     ORDER BY site_count DESC, owner_count DESC, c.slug ASC
     LIMIT ?`,
    [componentType, minSites, limit]
  );
  return rows.map((row) => ({
    component_id: parseInt(row.id, 10),
    slug: row.slug,
    title: row.title,
    wporg_status: row.wporg_status_slug || null,
    site_count: parseInt(row.site_count, 10),
    owner_count: parseInt(row.owner_count, 10),
    versions: row.versions ? String(row.versions).split(',') : [],
    latest_version: row.latest_version || null,
    latest_version_source: row.latest_version_source || null,
    feed_type: row.feed_type_slug || null,
  }));
};

module.exports = {
  FEED_TYPE_WORDPRESSORG,
  FEED_URL_MAX_LENGTH,
  FEED_ERROR_MAX_LENGTH,
  findTypes,
  typeExists,
  addType,
  findByComponentId,
  list,
  count,
  save,
  setEnabled,
  remove,
  recordFailure,
  recordSuccess,
  findCandidates,
};
