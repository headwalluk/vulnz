const db = require('../db');
const versionCompare = require('../lib/versionCompare');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS components (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(255) NOT NULL,
      component_type_slug VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      url VARCHAR(255),
      description VARCHAR(4096),
      synced_from_wporg BOOLEAN DEFAULT FALSE,
      UNIQUE(slug, component_type_slug),
      FOREIGN KEY (component_type_slug) REFERENCES component_types(slug),
      FULLTEXT(slug, title)
    )
  `;
  await db.query(sql);
}

async function search(query, page = 1, limit = 10) {
  const offset = (page - 1) * limit;
  const searchQuery = `%${query}%`;

  // We want all component ids, for all pages.
  const componentsSql = `
    (SELECT id, 1 as priority FROM components WHERE slug = ?)
    UNION
    (SELECT id, 2 as priority FROM components WHERE slug LIKE ?)
    UNION
    (SELECT id, 3 as priority FROM components WHERE title LIKE ?)
    UNION
    (SELECT id, 4 as priority FROM components WHERE MATCH(slug, title) AGAINST(? IN BOOLEAN MODE))
    ORDER BY priority ASC
  `;

  if (process.env.LOG_LEVEL === 'debug') {
    console.log('Executing componentsSql with params:', [query, searchQuery, searchQuery, query]);
  }

  const allComponentIds = (await db.query(componentsSql, [query, searchQuery, searchQuery, query])).map((c) => c.id);

  // Remove duplicates while preserving order.
  const uniqueComponentIds = [...new Set(allComponentIds)];

  // Total number of unique components found.
  const total = uniqueComponentIds.length;

  // Grab only the component ids for the requested page.
  const wantedComponentIds = uniqueComponentIds.slice(offset, offset + limit);

  if (allComponentIds.length === 0) {
    return { components: [], total: 0 };
  }

  const dataSql = `
    SELECT
      c.id AS component_id, c.slug, c.component_type_slug, c.title, c.url,
      r.id AS release_id, r.version,
      v.url AS vulnerability_url
    FROM components c
    LEFT JOIN releases r ON c.id = r.component_id
    LEFT JOIN vulnerabilities v ON r.id = v.release_id
    WHERE c.id IN (?)
  `;

  const rows = await db.query(dataSql, [wantedComponentIds]);

  const componentsMap = new Map();
  for (const row of rows) {
    if (!componentsMap.has(row.component_id)) {
      componentsMap.set(row.component_id, {
        id: row.component_id,
        slug: row.slug,
        component_type_slug: row.component_type_slug,
        title: row.title,
        url: row.url,
        releases: new Map(),
      });
    }

    const component = componentsMap.get(row.component_id);
    if (row.release_id && !component.releases.has(row.release_id)) {
      component.releases.set(row.release_id, {
        version: row.version,
        vulnerabilities: [],
      });
    }

    if (row.vulnerability_url) {
      component.releases.get(row.release_id).vulnerabilities.push(row.vulnerability_url);
    }
  }

  // The wantedComponentIds are already paginated, so we can just iterate over them
  // to build the result in the correct order.
  const result = [];
  for (const componentId of wantedComponentIds) {
    const component = componentsMap.get(componentId);
    if (component) {
      component.releases = Array.from(component.releases.values());
      component.releases.sort((a, b) => versionCompare(b.version, a.version));
      for (const release of component.releases) {
        release.has_vulnerabilities = release.vulnerabilities.length > 0;
      }
      result.push(component);
    }
  }

  return { components: result, total };
}

const findOrCreate = async (slug, componentTypeSlug, title) => {
  let rows = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [slug, componentTypeSlug]);
  let component = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  if (!component) {
    const result = await db.query('INSERT INTO components (slug, component_type_slug, title) VALUES (?, ?, ?)', [slug, componentTypeSlug, title]);
    const insertId = result.insertId;
    rows = await db.query('SELECT * FROM components WHERE id = ?', [insertId]);
    component = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
  }
  return component;
};

/**
 * Find plugins that haven't been updated in X months
 * Only considers WordPress.org plugins (where last_updated IS NOT NULL)
 * Returns plugins used by specified user's websites
 */
async function findUnmaintainedPlugins(monthsThreshold = 6, userId = null) {
  let sql = `
    SELECT DISTINCT
      c.id,
      c.slug,
      c.title,
      c.last_updated,
      TIMESTAMPDIFF(MONTH, c.last_updated, NOW()) as months_since_update,
      w.domain,
      w.title as website_title
    FROM components c
    JOIN releases r ON c.id = r.component_id
    JOIN website_components wc ON r.id = wc.release_id
    JOIN websites w ON wc.website_id = w.id
    WHERE c.component_type_slug = 'wordpress-plugin'
      AND c.last_updated IS NOT NULL
      AND c.last_updated < DATE_SUB(NOW(), INTERVAL ? MONTH)
  `;

  const params = [monthsThreshold];

  if (userId !== null) {
    sql += ' AND w.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY c.last_updated ASC, c.title ASC';

  return await db.query(sql, params);
}

/**
 * Find plugins that were recently published (within X months)
 * Only considers WordPress.org plugins (where added IS NOT NULL)
 * Returns plugins used by specified user's websites
 */
async function findNewlyPublishedPlugins(monthsThreshold = 3, userId = null) {
  let sql = `
    SELECT DISTINCT
      c.id,
      c.slug,
      c.title,
      c.added,
      TIMESTAMPDIFF(MONTH, c.added, NOW()) as months_since_published,
      w.domain,
      w.title as website_title
    FROM components c
    JOIN releases r ON c.id = r.component_id
    JOIN website_components wc ON r.id = wc.release_id
    JOIN websites w ON wc.website_id = w.id
    WHERE c.component_type_slug = 'wordpress-plugin'
      AND c.added IS NOT NULL
      AND c.added > DATE_SUB(NOW(), INTERVAL ? MONTH)
  `;

  const params = [monthsThreshold];

  if (userId !== null) {
    sql += ' AND w.user_id = ?';
    params.push(userId);
  }

  sql += ' ORDER BY c.added DESC, c.title ASC';

  return await db.query(sql, params);
}

/**
 * Invalidate WordPress.org sync status for specific components
 * Sets synced_from_wporg = 0 to trigger immediate re-sync
 * Used when components are added/updated on websites
 */
async function invalidateWpOrgSyncStatus(componentIds) {
  if (!Array.isArray(componentIds) || componentIds.length === 0) {
    return;
  }

  await db.query('UPDATE components SET synced_from_wporg = 0 WHERE id IN (?)', [componentIds]);
}

/**
 * Invalidate WordPress.org sync status for plugins not synced in X days
 * Sets synced_from_wporg = 0 for all plugins where synced_from_wporg_at is older than threshold
 * Called by cron job to ensure periodic re-sync of all plugins
 */
async function invalidateStaleSyncs(daysThreshold = 7) {
  const result = await db.query(
    `UPDATE components 
     SET synced_from_wporg = 0 
     WHERE component_type_slug = 'wordpress-plugin'
       AND synced_from_wporg = 1
       AND synced_from_wporg_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [daysThreshold]
  );

  return result.affectedRows || 0;
}

module.exports = {
  createTable,
  search,
  findOrCreate,
  findUnmaintainedPlugins,
  findNewlyPublishedPlugins,
  invalidateWpOrgSyncStatus,
  invalidateStaleSyncs,
};
