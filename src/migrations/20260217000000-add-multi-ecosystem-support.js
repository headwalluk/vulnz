const db = require('../db');

const up = async () => {
  // 1. Create ecosystems table
  await db.query(`
    CREATE TABLE IF NOT EXISTS ecosystems (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      data JSON NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 2. Seed initial ecosystems
  await db.query(`
    INSERT INTO ecosystems (slug, name, description, data) VALUES
      ('wordpress', 'WordPress', 'WordPress plugins and themes', JSON_OBJECT(
        'urlBase', 'https://api.wordpress.org',
        'vulnerabilityFeed', 'https://www.wordfence.com/api/intelligence/v2/vulnerabilities/production',
        'metadataSync', true
      )),
      ('npm', 'npm', 'Node.js packages from the npm registry', JSON_OBJECT(
        'registryUrl', 'https://registry.npmjs.org',
        'vulnerabilityFeed', 'https://api.osv.dev/v1/query',
        'metadataSync', false
      ))
    ON DUPLICATE KEY UPDATE slug = slug
  `);

  // 3. Add ecosystem_id to component_types
  await db.query(`
    ALTER TABLE component_types
    ADD COLUMN ecosystem_id BIGINT UNSIGNED NULL AFTER id
  `);

  await db.query(`
    ALTER TABLE component_types
    ADD FOREIGN KEY fk_component_types_ecosystem (ecosystem_id)
    REFERENCES ecosystems(id) ON DELETE SET NULL
  `);

  // 4. Link existing WordPress component types to the wordpress ecosystem
  await db.query(`
    UPDATE component_types
    SET ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress')
    WHERE slug IN ('wordpress-plugin', 'wordpress-theme')
  `);

  // 5. Add npm-package component type
  await db.query(`
    INSERT INTO component_types (ecosystem_id, slug, name)
    SELECT e.id, 'npm-package', 'npm Package'
    FROM ecosystems e
    WHERE e.slug = 'npm'
    AND NOT EXISTS (
      SELECT 1 FROM component_types WHERE slug = 'npm-package'
    )
  `);

  // 6. Add ecosystem_id and platform_metadata to websites
  await db.query(`
    ALTER TABLE websites
    ADD COLUMN ecosystem_id BIGINT UNSIGNED NULL AFTER user_id,
    ADD COLUMN platform_metadata JSON NULL AFTER meta
  `);

  await db.query(`
    ALTER TABLE websites
    ADD FOREIGN KEY fk_websites_ecosystem (ecosystem_id)
    REFERENCES ecosystems(id) ON DELETE SET NULL
  `);

  await db.query(`
    ALTER TABLE websites
    ADD INDEX ecosystem_idx (ecosystem_id)
  `);

  // 7. Migrate existing websites to the wordpress ecosystem
  await db.query(`
    UPDATE websites
    SET
      ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress'),
      platform_metadata = JSON_OBJECT(
        'name', 'WordPress',
        'version', COALESCE(wordpress_version, ''),
        'phpVersion', COALESCE(php_version, ''),
        'databaseEngine', COALESCE(db_server_type, 'unknown'),
        'databaseVersion', COALESCE(db_server_version, '')
      )
    WHERE ecosystem_id IS NULL
  `);
};

module.exports = { up };
