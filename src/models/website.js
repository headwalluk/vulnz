const db = require('../db');
const { stripAll } = require('../lib/sanitizer');

/**
 * Normalise a website title on the way in.
 *
 * Titles arrive from WordPress (`get_bloginfo('name')`) already HTML-encoded
 * — "Headwall Demo &amp; Dev" — and were previously stored verbatim, so the
 * entity travelled all the way out to API consumers and into report emails.
 * Decoding at the write path means the database holds plain text and each
 * presentation layer encodes as it sees fit, which is how component titles
 * have worked since 20251221130000-decode-html-entities-in-components.js.
 *
 * stripAll() also removes any HTML tags, which matters because the weekly
 * report renders the title unescaped (`{{{websiteTitle}}}`).
 */
const cleanTitle = (title) => (typeof title === 'string' ? stripAll(title).trim() : title);

const PLUGIN_TYPE = 'wordpress-plugin';
const THEME_TYPE = 'wordpress-theme';

/**
 * The component types the per-website counts are derived from.
 *
 * Deliberately the same two types `getWebsiteComponents()` lists in the
 * websites route: a count that also included npm packages would sort sites
 * into an order the returned component lists could not explain.
 */
const COUNTED_COMPONENT_TYPES = [PLUGIN_TYPE, THEME_TYPE];
const COUNTED_TYPE_PLACEHOLDERS = COUNTED_COMPONENT_TYPES.map(() => '?').join(', ');

/**
 * Counts computed in SQL rather than in the route.
 *
 * The route also derives vulnerability_count and malware_count in JavaScript
 * from the component lists it fetches, and those remain the values returned.
 * These exist because that derivation happens *after* pagination, so it can
 * annotate a page but cannot order one — "the ten most vulnerable sites"
 * needs the whole set ranked in the database.
 *
 * Both count distinct components, not releases, to match the route: a
 * component with three separate vulnerability rows is one vulnerable
 * component, not three.
 */
const VULNERABILITY_COUNT_SQL = `(
  SELECT COUNT(DISTINCT c.id)
  FROM website_components wc
  JOIN releases r ON wc.release_id = r.id
  JOIN components c ON r.component_id = c.id
  JOIN vulnerabilities v ON v.release_id = r.id
  WHERE wc.website_id = w.id
    AND c.component_type_slug IN (${COUNTED_TYPE_PLACEHOLDERS})
)`;

const MALWARE_COUNT_SQL = `(
  SELECT COUNT(DISTINCT c.id)
  FROM website_components wc
  JOIN releases r ON wc.release_id = r.id
  JOIN components c ON r.component_id = c.id
  WHERE wc.website_id = w.id
    AND c.is_malware = 1
    AND c.component_type_slug IN (${COUNTED_TYPE_PLACEHOLDERS})
)`;

/**
 * Mirrors the wporg_statuses lookup table. Duplicated as a constant so a
 * caller-supplied filter value can be validated without a round trip on
 * every request; the FK on components.wporg_status_slug is the real
 * authority, and a status added there must be added here too.
 */
const WPORG_STATUSES = ['unknown', 'available', 'closed', 'absent'];

const SORT_NEWEST = 'newest';
const SORT_VULNERABILITIES = 'vulnerabilities';
const SORT_MALWARE = 'malware';

/**
 * Whitelisted sort orders. The value is interpolated into the query, so it
 * must never come from the caller directly — findAll() looks the caller's
 * choice up in here and falls back to newest.
 *
 * Every order ends in `w.id DESC` so that sites tied on a count come back in
 * a stable order across pages rather than shuffling between requests.
 */
const SORT_CLAUSES = {
  [SORT_NEWEST]: 'w.id DESC',
  [SORT_VULNERABILITIES]: 'vulnerability_count DESC, malware_count DESC, w.id DESC',
  [SORT_MALWARE]: 'malware_count DESC, vulnerability_count DESC, w.id DESC',
};

const SORTS = Object.keys(SORT_CLAUSES);

/**
 * Restrict a website query to sites carrying a particular kind of component.
 *
 * Two things can anchor the filter:
 *
 *   - `componentSlug` — a named component ("who runs foobar").
 *   - `componentWporgStatus` — a directory status ("who runs anything
 *     wordpress.org withdrew"). Without this, answering that question means
 *     enumerating every closed slug and issuing one request per slug, which
 *     is the whole point of the closure data being unusable.
 *
 * `componentType` narrows either anchor. `componentVersion` narrows only a
 * slug, because a bare version number means nothing across components.
 * The route rejects the combinations this cannot express rather than
 * ignoring the surplus parameter.
 *
 * Aliased away from the `wc`/`r`/`v` used by the onlyVulnerable join so the
 * filters compose — "sites running a withdrawn plugin that also have a known
 * vulnerability" is a single query.
 *
 * @returns {{join: string, where: string[], params: Array}}
 */
const componentFilter = ({ componentSlug, componentType, componentVersion, componentWporgStatus }) => {
  if (!componentSlug && !componentWporgStatus) {
    return { join: '', where: [], params: [] };
  }

  const join = `
    JOIN website_components fwc ON w.id = fwc.website_id
    JOIN releases fr ON fwc.release_id = fr.id
    JOIN components fc ON fr.component_id = fc.id
  `;
  const where = [];
  const params = [];

  if (componentSlug) {
    where.push('fc.slug = ?');
    params.push(componentSlug);
  }

  if (componentWporgStatus) {
    where.push('fc.wporg_status_slug = ?');
    params.push(componentWporgStatus);
  }

  if (componentType) {
    where.push('fc.component_type_slug = ?');
    params.push(componentType);
  }

  if (componentVersion) {
    where.push('fr.version = ?');
    params.push(componentVersion);
  }

  return { join, where, params };
};

const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS websites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      domain VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_ssl BOOLEAN DEFAULT TRUE,
      is_dev BOOLEAN NOT NULL DEFAULT FALSE,
      meta JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY user_website (user_id, domain),
      KEY domain_idx (domain)
    )
  `;
  await db.query(query);
};

/**
 * @param {number|null} userId  Owner to scope to; null returns every website.
 * @param {number} limit
 * @param {number} offset
 * @param {string|null} search  Matched against the domain.
 * @param {boolean} onlyVulnerable
 * @param {object} [options]
 * @param {string} [options.componentSlug]     Only sites carrying this component.
 * @param {string} [options.componentType]     Narrows componentSlug to one component type.
 * @param {string} [options.componentVersion]  Narrows componentSlug to one release.
 * @param {string} [options.sort]              One of SORTS; unknown values fall back to newest.
 */
const findAll = async (userId, limit, offset, search, onlyVulnerable, options = {}) => {
  const params = [...COUNTED_COMPONENT_TYPES, ...COUNTED_COMPONENT_TYPES];
  let query = `
    SELECT w.*,
      ${VULNERABILITY_COUNT_SQL} AS vulnerability_count,
      ${MALWARE_COUNT_SQL} AS malware_count
    FROM websites w
  `;
  const whereClauses = [];

  if (onlyVulnerable) {
    query += `
      JOIN website_components wc ON w.id = wc.website_id
      JOIN releases r ON wc.release_id = r.id
      JOIN vulnerabilities v ON r.id = v.release_id
    `;
  }

  const filter = componentFilter(options);
  query += filter.join;
  whereClauses.push(...filter.where);
  params.push(...filter.params);

  if (userId) {
    whereClauses.push('w.user_id = ?');
    params.push(userId);
  }

  if (search) {
    whereClauses.push('w.domain LIKE ?');
    params.push(`%${search}%`);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  // Either join can multiply a website across rows — one per matching
  // release — so collapse back to one row per site.
  if (onlyVulnerable || filter.join) {
    query += ' GROUP BY w.id';
  }

  query += ` ORDER BY ${SORT_CLAUSES[options.sort] || SORT_CLAUSES[SORT_NEWEST]} LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  const rows = await db.query(query, params);
  return Array.isArray(rows) ? rows : [];
};

const countAll = async (userId, search, onlyVulnerable, options = {}) => {
  let query = 'SELECT COUNT(DISTINCT w.id) as count FROM websites w';
  const params = [];
  const whereClauses = [];

  if (onlyVulnerable) {
    query += `
      JOIN website_components wc ON w.id = wc.website_id
      JOIN releases r ON wc.release_id = r.id
      JOIN vulnerabilities v ON r.id = v.release_id
    `;
  }

  const filter = componentFilter(options);
  query += filter.join;
  whereClauses.push(...filter.where);
  params.push(...filter.params);

  if (userId) {
    whereClauses.push('w.user_id = ?');
    params.push(userId);
  }

  if (search) {
    whereClauses.push('w.domain LIKE ?');
    params.push(`%${search}%`);
  }

  if (whereClauses.length > 0) {
    query += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  const rows = await db.query(query, params);
  return Number(rows[0].count);
};

const findByDomain = async (domain) => {
  const rows = await db.query('SELECT * FROM websites WHERE domain = ?', [domain]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

const create = async (website) => {
  const { user_id, domain, title, is_dev, meta, ecosystem_id, platform_metadata } = website;
  const result = await db.query('INSERT INTO websites (user_id, domain, title, is_dev, meta, ecosystem_id, platform_metadata) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    user_id,
    domain,
    cleanTitle(title),
    is_dev,
    JSON.stringify(meta),
    ecosystem_id || null,
    platform_metadata ? JSON.stringify(platform_metadata) : null,
  ]);
  const insertId = result.insertId || result[0]?.insertId;
  return { id: insertId, ...website };
};

const update = async (domain, website) => {
  if (typeof website.title === 'string') {
    website.title = cleanTitle(website.title);
  }

  const fields = Object.keys(website);
  const values = Object.values(website);

  if (website.meta) {
    website.meta = JSON.stringify(website.meta);
  }
  if (website.platform_metadata) {
    website.platform_metadata = JSON.stringify(website.platform_metadata);
  }

  const setClause = fields.map((field) => `${field} = ?`).join(', ');

  if (fields.length === 0) {
    return false;
  }

  const query = `UPDATE websites SET ${setClause} WHERE domain = ?`;
  const params = [...values, domain];

  // Diagnostics
  // console.log( query, params );

  const result = await db.query(query, params);
  return result.affectedRows > 0;
};

const remove = async (domain) => {
  const result = await db.query('DELETE FROM websites WHERE domain = ?', [domain]);
  return result.affectedRows > 0;
};

const touch = async (websiteId) => {
  const result = await db.query('UPDATE websites SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [websiteId]);
  return result.affectedRows > 0;
};

const removeStaleWebsites = async (days) => {
  const result = await db.query('DELETE FROM websites WHERE updated_at < NOW() - INTERVAL ? DAY', [days]);
  return result.affectedRows || 0;
};

// Maps version column names to their platform_metadata JSON key equivalents
const VERSION_TO_PLATFORM_KEY = {
  wordpress_version: 'version',
  php_version: 'phpVersion',
  db_server_type: 'databaseEngine',
  db_server_version: 'databaseVersion',
};

// Maps platform_metadata JSON keys to their version column equivalents
const PLATFORM_KEY_TO_VERSION = {
  version: 'wordpress_version',
  phpVersion: 'php_version',
  databaseEngine: 'db_server_type',
  databaseVersion: 'db_server_version',
};

const updateVersions = async (websiteId, versions) => {
  const fields = [];
  const values = [];

  if (versions.wordpress_version !== undefined) {
    fields.push('wordpress_version = ?');
    values.push(versions.wordpress_version);
  }
  if (versions.php_version !== undefined) {
    fields.push('php_version = ?');
    values.push(versions.php_version);
  }
  if (versions.db_server_type !== undefined) {
    fields.push('db_server_type = ?');
    values.push(versions.db_server_type);
  }
  if (versions.db_server_version !== undefined) {
    fields.push('db_server_version = ?');
    values.push(versions.db_server_version);
  }

  if (fields.length === 0) {
    return false;
  }

  // Sync version columns into platform_metadata (when it exists)
  // Build a nested JSON_SET expression to patch only the changed keys
  let jsonExpr = 'platform_metadata';
  const jsonValues = [];
  for (const [col, platformKey] of Object.entries(VERSION_TO_PLATFORM_KEY)) {
    if (versions[col] !== undefined) {
      jsonExpr = `JSON_SET(${jsonExpr}, '$.${platformKey}', ?)`;
      jsonValues.push(versions[col] || '');
    }
  }
  if (jsonValues.length > 0) {
    fields.push(`platform_metadata = CASE WHEN platform_metadata IS NOT NULL THEN ${jsonExpr} ELSE platform_metadata END`);
    values.push(...jsonValues);
  }

  // Always update the versions_last_checked_at timestamp
  fields.push('versions_last_checked_at = CURRENT_TIMESTAMP');

  values.push(websiteId);
  const query = `UPDATE websites SET ${fields.join(', ')} WHERE id = ?`;
  const result = await db.query(query, values);
  return result.affectedRows > 0;
};

const findOutdatedWordPress = async (minVersion, userId = null) => {
  let query = `
    SELECT * FROM websites 
    WHERE wordpress_version IS NOT NULL 
    AND wordpress_version < ?
  `;
  const params = [minVersion];

  if (userId !== null) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY wordpress_version ASC';
  return await db.query(query, params);
};

const findOutdatedPhp = async (minVersion, userId = null) => {
  let query = `
    SELECT * FROM websites 
    WHERE php_version IS NOT NULL 
    AND php_version < ?
  `;
  const params = [minVersion];

  if (userId !== null) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY php_version ASC';
  return await db.query(query, params);
};

const getVersionDistribution = async (userId = null) => {
  let query = `
    SELECT 
      wordpress_version,
      php_version,
      db_server_type,
      db_server_version,
      COUNT(*) as count
    FROM websites
  `;
  const params = [];

  if (userId) {
    query += ' WHERE user_id = ?';
    params.push(userId);
  }

  query += ' GROUP BY wordpress_version, php_version, db_server_type, db_server_version';

  return await db.query(query, params);
};

module.exports = {
  createTable,
  findAll,
  countAll,
  findByDomain,
  create,
  update,
  remove,
  touch,
  removeStaleWebsites,
  updateVersions,
  findOutdatedWordPress,
  findOutdatedPhp,
  getVersionDistribution,
  PLATFORM_KEY_TO_VERSION,
  SORTS,
  WPORG_STATUSES,
  SORT_NEWEST,
  SORT_VULNERABILITIES,
  SORT_MALWARE,
};
