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

  const countSql = `
    SELECT COUNT(*) as total FROM (
      (SELECT id FROM components WHERE slug = ?)
      UNION
      (SELECT id FROM components WHERE slug LIKE ?)
      UNION
      (SELECT id FROM components WHERE title LIKE ?)
      UNION
      (SELECT id FROM components WHERE MATCH(slug, title) AGAINST(? IN BOOLEAN MODE))
    ) as total_components
  `;
  const [{ total }] = await db.query(countSql, [query, searchQuery, searchQuery, query]);

  const componentsSql = `
    (SELECT id, 1 as priority FROM components WHERE slug = ?)
    UNION
    (SELECT id, 2 as priority FROM components WHERE slug LIKE ?)
    UNION
    (SELECT id, 3 as priority FROM components WHERE title LIKE ?)
    UNION
    (SELECT id, 4 as priority FROM components WHERE MATCH(slug, title) AGAINST(? IN BOOLEAN MODE))
    ORDER BY priority
    LIMIT ? OFFSET ?
  `;

  const componentIds = (await db.query(componentsSql, [query, searchQuery, searchQuery, query, limit, offset])).map(c => c.id);

  if (componentIds.length === 0) {
    return { components: [], total: 0 };
  }

  const dataSql = `
    SELECT
      c.id AS component_id, c.slug, c.component_type_slug, c.title, c.description,
      r.id AS release_id, r.version,
      v.url AS vulnerability_url
    FROM components c
    LEFT JOIN releases r ON c.id = r.component_id
    LEFT JOIN vulnerabilities v ON r.id = v.release_id
    WHERE c.id IN (?)
  `;

  const rows = await db.query(dataSql, [componentIds]);

  const componentsMap = new Map();
  for (const row of rows) {
    if (!componentsMap.has(row.component_id)) {
      componentsMap.set(row.component_id, {
        slug: row.slug,
        component_type_slug: row.component_type_slug,
        title: row.title,
        description: row.description,
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

  const result = [];
  for (const component of componentsMap.values()) {
    component.releases = Array.from(component.releases.values());
    component.releases.sort((a, b) => versionCompare(b.version, a.version));
    for (const release of component.releases) {
      release.has_vulnerabilities = release.vulnerabilities.length > 0;
    }
    result.push(component);
  }

  return { components: result, total };
}

module.exports = {
  createTable,
  search,
};
