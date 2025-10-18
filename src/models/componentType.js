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
    { slug: 'wordpress-plugin', title: 'WordPress Plugin' }
  ];

  for (const type of componentTypes) {
    // Using INSERT IGNORE to avoid errors if the record already exists
    await db.query('INSERT IGNORE INTO component_types (slug, title) VALUES (?, ?)', [type.slug, type.title]);
  }
}

module.exports = {
  createTable,
  seedData
};
