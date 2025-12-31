const db = require('../db');
const { decodeHtmlEntities } = require('../lib/sanitizer');

/**
 * Migration: Decode HTML entities in component titles and descriptions
 *
 * Context: Components imported from WordPress.org API contain HTML entities
 * (e.g., "&amp;", "&gt;", etc.) which cause double-encoding when rendered
 * in Handlebars templates.
 *
 * This migration:
 * 1. Decodes HTML entities in title and description columns
 * 2. Stores plain text in the database
 * 3. Lets Handlebars handle encoding at presentation layer
 */
const up = async () => {
  console.log('Starting HTML entity decoding in components...');

  // Fetch all components that might have HTML entities
  const components = await db.query('SELECT id, title, description FROM components WHERE title LIKE "%&%" OR description LIKE "%&%"');

  let updatedCount = 0;

  for (const component of components) {
    const decodedTitle = component.title ? decodeHtmlEntities(component.title) : component.title;
    const decodedDescription = component.description ? decodeHtmlEntities(component.description) : component.description;

    // Only update if something changed
    if (decodedTitle !== component.title || decodedDescription !== component.description) {
      await db.query('UPDATE components SET title = ?, description = ? WHERE id = ?', [decodedTitle, decodedDescription, component.id]);
      updatedCount++;

      if (updatedCount % 50 === 0) {
        console.log(`  Decoded ${updatedCount} components...`);
      }
    }
  }

  console.log(`Migration complete. Decoded HTML entities in ${updatedCount} components.`);
};

module.exports = {
  up,
};
