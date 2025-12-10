/**
 * Migration: Create app_settings table
 *
 * A key-value configuration system for runtime parameters that can be
 * modified without application restarts. Replaces hardcoded values and
 * environment variables for non-sensitive configuration.
 */

const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS app_settings (
        setting_key VARCHAR(255) NOT NULL PRIMARY KEY,
        setting_value TEXT NOT NULL,
        value_type ENUM('string', 'integer', 'float', 'boolean') NOT NULL DEFAULT 'string',
        description TEXT,
        category VARCHAR(100),
        is_system TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_category (category),
        INDEX idx_is_system (is_system)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await db.query(query);

  // Seed default settings
  const seedQuery = `
      INSERT IGNORE INTO app_settings (setting_key, setting_value, value_type, description, category, is_system) VALUES
      -- WordPress Version Settings
      ('wordpress.current_version', '6.7.1', 'string', 'Current stable WordPress version', 'versions', 1),
      ('wordpress.minimum_version', '6.4', 'string', 'Minimum acceptable WordPress version', 'versions', 1),
      
      -- PHP Version Settings
      ('php.minimum_version', '8.1', 'string', 'Minimum required PHP version', 'versions', 1),
      ('php.recommended_version', '8.3', 'string', 'Recommended PHP version for best performance', 'versions', 1),
      ('php.eol_version', '7.4', 'string', 'PHP version that is end-of-life', 'versions', 1),
      
      -- Database Version Settings
      ('database.mysql_minimum_version', '8.0', 'string', 'Minimum MySQL version', 'versions', 1),
      ('database.mariadb_minimum_version', '10.5', 'string', 'Minimum MariaDB version', 'versions', 1),
      
      -- Data Retention Settings
      ('retention.security_events_days', '30', 'integer', 'Days to retain security event records', 'retention', 1),
      ('retention.file_security_issues_days', '30', 'integer', 'Days to retain file security scan results', 'retention', 1),
      ('retention.component_changes_days', '365', 'integer', 'Days to retain component change history', 'retention', 1),
      ('retention.email_logs_days', '90', 'integer', 'Days to retain email delivery logs', 'retention', 1),
      
      -- Batch Processing Settings
      ('batch.vulnerability_check_size', '50', 'integer', 'Number of components to check per batch', 'limits', 1),
      ('batch.report_websites_per_batch', '100', 'integer', 'Number of websites to process per report batch', 'limits', 1),
      
      -- Rate Limiting Settings
      ('rate.api_requests_per_minute', '60', 'integer', 'API requests allowed per minute per user', 'limits', 1),
      ('rate.scan_requests_per_hour', '10', 'integer', 'Security scans allowed per hour per website', 'limits', 1),
      
      -- Feature Flags
      ('feature.geoip_enabled', 'true', 'boolean', 'Enable GeoIP lookups for security events', 'features', 1),
      ('feature.component_change_tracking', 'true', 'boolean', 'Track plugin/theme additions and updates', 'features', 1),
      ('feature.version_tracking', 'true', 'boolean', 'Track WordPress/PHP/Database versions', 'features', 1),
      
      -- Report Configuration
      ('report.include_security_events', 'true', 'boolean', 'Include security events in weekly reports', 'reports', 1),
      ('report.include_version_status', 'true', 'boolean', 'Include version status in weekly reports', 'reports', 1),
      ('report.include_component_changes', 'true', 'boolean', 'Include component changes in weekly reports', 'reports', 1),
      ('report.include_static_analysis', 'true', 'boolean', 'Include static analysis results in weekly reports', 'reports', 1),
      ('report.security_event_limit', '50', 'integer', 'Maximum security events to show per website in reports', 'reports', 1)
      ;
  `;
  await db.query(seedQuery);

  console.log('✅ Created app_settings table and seeded default values');
};

const down = async () => {
  await db.query('DROP TABLE IF EXISTS app_settings;');
  console.log('✅ Dropped app_settings table');
};

module.exports = { up, down };
