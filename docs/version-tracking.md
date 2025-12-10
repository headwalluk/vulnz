# Version Tracking

## Overview

Track core software versions for monitored websites, including WordPress, PHP, and database server versions. This provides visibility into outdated software that may have known vulnerabilities.

## Goals

- Monitor WordPress core version across all websites
- Track PHP runtime version
- Track database server type and version (MySQL/MariaDB)
- Alert administrators to outdated software in weekly reports
- Support version comparison for vulnerability correlation

## Data Ingestion

Version information is reported via the VULNZ API by the website hosting provider. The hosting provider determines the appropriate method for collecting version data from their systems.

**Collection Methods** (provider responsibility):

- Parse WordPress `wp-includes/version.php` for WordPress version
- Execute `php -v` or check `phpversion()` for PHP version
- Query `SELECT VERSION()` for database version
- Parse server headers or configuration files

## Data Model

Version tracking is implemented as additional fields on the existing `websites` table rather than a separate model. This simplifies queries and avoids unnecessary joins.

### Schema Changes to `websites` Table

```sql
ALTER TABLE websites ADD COLUMN wordpress_version VARCHAR(20) AFTER meta;
ALTER TABLE websites ADD COLUMN php_version VARCHAR(20) AFTER wordpress_version;
ALTER TABLE websites ADD COLUMN db_server_type ENUM('mysql', 'mariadb', 'unknown') DEFAULT 'unknown' AFTER php_version;
ALTER TABLE websites ADD COLUMN db_server_version VARCHAR(20) AFTER db_server_type;
ALTER TABLE websites ADD COLUMN versions_last_checked_at TIMESTAMP NULL AFTER db_server_version;

ALTER TABLE websites ADD INDEX idx_wordpress_version (wordpress_version);
ALTER TABLE websites ADD INDEX idx_php_version (php_version);
```

**Rationale for Table Structure**:

- These are metadata about the hosting environment, not components with releases
- No need for version history tracking (current state is sufficient)
- Simpler queries: `SELECT * FROM websites WHERE wordpress_version < '6.4'`
- No additional joins required for reports

## Version Format

Versions should be stored in semver-compatible format where possible:

- WordPress: `6.4.2`, `6.5.0`
- PHP: `8.2.14`, `8.3.1`
- Database: `10.11.6-MariaDB`, `8.0.35`

**Normalization**: Strip build metadata and platform-specific suffixes before storage to enable version comparison.

## API Endpoints

### PUT /api/websites/:id/versions

Update version information for a website.

**Authentication**: API key or session with access to the website

**Request Body**:

```json
{
  "wordpress_version": "6.4.2",
  "php_version": "8.2.14",
  "db_server_type": "mariadb",
  "db_server_version": "10.11.6"
}
```

**Response**: `200 OK` with updated website object

**Behavior**:

- Updates `versions_last_checked_at` timestamp automatically
- Partial updates allowed (can update just WordPress version, for example)
- Invalid version formats return `400 Bad Request`

### GET /api/websites/:id

Existing endpoint - response now includes version fields:

```json
{
  "id": 123,
  "domain": "example.com",
  "wordpress_version": "6.4.2",
  "php_version": "8.2.14",
  "db_server_type": "mariadb",
  "db_server_version": "10.11.6",
  "versions_last_checked_at": "2025-12-06T10:30:00Z",
  ...
}
```

## Version Comparison

For reporting, we need to identify outdated software. This requires tracking current/recommended versions.

### Configuration Approach

Store recommended versions in environment variables or configuration file:

```bash
WORDPRESS_STABLE_VERSION=6.4.2
PHP_MINIMUM_VERSION=8.1.0
PHP_RECOMMENDED_VERSION=8.3.0
MARIADB_MINIMUM_VERSION=10.6.0
MYSQL_MINIMUM_VERSION=8.0.0
```

**Update Process**: Manual updates by VULNZ administrator when new versions are released.

**Future Enhancement**: Automatic version checking via WordPress.org API or version-check services.

## Reporting Integration

Version information will be included in weekly vulnerability reports.

**Report Sections**:

1. **Outdated Software Summary**
   - Websites running EOL PHP versions
   - Websites behind on WordPress updates
   - Database servers needing updates

2. **Version Distribution**
   - PHP version breakdown (e.g., "5 sites on PHP 8.1, 12 sites on PHP 8.2")
   - WordPress version breakdown
   - Database server distribution

3. **Upgrade Recommendations**
   - Prioritized list: "Critical: 3 sites on PHP 7.4 (EOL)"
   - Links to upgrade documentation

4. **Version Change Detection**
   - Since last report: "example.com upgraded WordPress 6.3 → 6.4"
   - Since last report: "site2.com upgraded PHP 8.1 → 8.2"

## Version History Tracking (Future Enhancement)

Currently we only store the current version. For future enhancement, consider a `website_version_history` table to track changes over time:

```sql
CREATE TABLE website_version_history (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id INT UNSIGNED NOT NULL,
  software_type ENUM('wordpress', 'php', 'database'),
  old_version VARCHAR(20),
  new_version VARCHAR(20),
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  INDEX idx_website_software (website_id, software_type, detected_at)
);
```

This would enable:

- "How long has this site been on this PHP version?"
- Upgrade velocity metrics
- Compliance reporting

**Decision**: Defer this until proven necessary. Current state tracking is sufficient for initial implementation.

## Data Retention

Version data is tied to the website record and persists as long as the website is monitored. No separate retention policy needed.

The `versions_last_checked_at` timestamp can be used to identify stale data:

- Alert if versions haven't been checked in 7+ days
- Flag in reports: "Version data may be outdated"

## Implementation Notes

- Version comparison uses semantic versioning libraries (`semver` npm package)
- Handle edge cases: beta versions, release candidates, custom builds
- Validate version format in API endpoint (regex or semver parser)
- Consider storing normalized versions in separate columns for efficient comparison
- Database server type auto-detected from version string if not provided (e.g., "10.11.6-MariaDB" → "mariadb")

## Known Version Resources

- **WordPress**: https://api.wordpress.org/core/version-check/1.7/
- **PHP**: https://www.php.net/releases/active.php (scraping required, no API)
- **MariaDB**: https://mariadb.org/mariadb/all-releases/
- **MySQL**: https://dev.mysql.com/downloads/mysql/

These can be used to populate configuration with current stable/recommended versions.
