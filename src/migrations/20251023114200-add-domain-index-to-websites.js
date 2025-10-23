const db = require('../db');

const migrationName = '20251023114200-add-domain-index-to-websites';

const up = async () => {
  console.log(`Running migration: ${migrationName}`);

  // Check if index exists
  const indexExistsResult = await db.query("SHOW INDEX FROM websites WHERE Key_name = 'domain_idx'");

  if (Array.isArray(indexExistsResult) && indexExistsResult.length > 0) {
    console.log('Index `domain_idx` already exists on `websites` table. Skipping.');
    return;
  }

  // Create index
  await db.query('ALTER TABLE websites ADD INDEX domain_idx (domain)');
  console.log('Index `domain_idx` created on `websites` table.');
};

module.exports = { up };
