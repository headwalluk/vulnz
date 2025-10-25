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
        SELECT c.slug, c.title, c.component_type_slug, r.version, v.url as vulnerability_url
        FROM website_components wc
        JOIN releases r ON wc.release_id = r.id
        JOIN components c ON r.component_id = c.id
        LEFT JOIN vulnerabilities v ON r.id = v.release_id
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

module.exports = {
  createTable,
  create,
  deleteByType,
  getPlugins,
  getThemes,
};
