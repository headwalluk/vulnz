const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS component_types (
      slug VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL
    )
  `;
  await db.query(sql);
}

async function seedData() {
  const componentTypes = [
    { slug: 'wordpress-theme', title: 'WordPress Theme' },
    { slug: 'wordpress-plugin', title: 'WordPress Plugin' },
  ];

  for (const type of componentTypes) {
    // Using INSERT IGNORE to avoid errors if the record already exists
    await db.query('INSERT IGNORE INTO component_types (slug, title) VALUES (?, ?)', [type.slug, type.title]);
  }
}

/**
 * Every registered component type, ordered by slug for a stable listing.
 *
 * The seed above is WordPress-only, but the table is the authority — npm and
 * anything else added later arrive by migration. Callers validating a
 * caller-supplied type must read this rather than hardcode a list, or a new
 * ecosystem silently becomes unfilterable.
 */
async function findAll() {
  const rows = await db.query('SELECT slug, title FROM component_types ORDER BY slug');
  return Array.isArray(rows) ? rows : [];
}

module.exports = {
  createTable,
  seedData,
  findAll,
};
