const db = require('../db');
const vulnerabilityRange = require('./vulnerabilityRange');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS releases (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      component_id BIGINT UNSIGNED NOT NULL,
      version VARCHAR(255) NOT NULL,
      release_date DATE,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
      UNIQUE KEY \`component_id_version_unique\` (\`component_id\`, \`version\`)
    )
  `;
  await db.query(sql);
}

/**
 * Find a release, creating it and applying stored vulnerability ranges if it is new.
 *
 * The only path that inserts into releases; see docs/version-matching.md.
 *
 * @param {number} componentId
 * @param {string} version
 * @returns {Promise<{release: object, created: boolean, vulnerabilitiesCreated: number}>}
 */
const resolve = async (componentId, version) => {
  let rows = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [componentId, version]);
  let created = false;
  let vulnerabilitiesCreated = 0;
  if (rows.length === 0) {
    // INSERT IGNORE so a concurrent creator of the same release loses quietly; only
    // the winner applies ranges.
    const result = await db.query('INSERT IGNORE INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
    created = (result.affectedRows || 0) > 0;
    rows = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [componentId, version]);
    if (created) {
      vulnerabilitiesCreated = await vulnerabilityRange.applyRangesToRelease(rows[0]);
    }
  }
  return { release: rows[0], created, vulnerabilitiesCreated };
};

/** Find a release by component and version, creating it if missing. */
const findOrCreate = async (componentId, version) => {
  const { release } = await resolve(componentId, version);
  return release;
};

const findById = async (id) => {
  const rows = await db.query('SELECT * FROM releases WHERE id = ?', [id]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

module.exports = {
  createTable,
  resolve,
  findOrCreate,
  findById,
};
