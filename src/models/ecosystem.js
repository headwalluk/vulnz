const db = require('../db');

/**
 * Find all active ecosystems.
 * @returns {Promise<Array>} Array of ecosystem records
 */
async function findAll() {
  const rows = await db.query('SELECT id, slug, name, description, active FROM ecosystems WHERE active = TRUE ORDER BY name ASC');
  return Array.isArray(rows) ? rows : [];
}

/**
 * Find an ecosystem by its slug.
 * @param {string} slug - The ecosystem slug (e.g. 'wordpress', 'npm')
 * @returns {Promise<Object|null>} Ecosystem record or null if not found
 */
async function findBySlug(slug) {
  const rows = await db.query('SELECT id, slug, name, description, active FROM ecosystems WHERE slug = ?', [slug]);
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }
  const eco = rows[0];
  return {
    ...eco,
    id: parseInt(eco.id, 10),
    active: Boolean(eco.active),
  };
}

module.exports = {
  findAll,
  findBySlug,
};
