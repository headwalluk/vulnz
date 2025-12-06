# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/roadmap.md)

Self-hosted vulnerability database for WordPress plugins and themes. The database is primarily accessed through an API, and there is a UI for basic admin tasks.

The application pulls from wordpress.org for plugin & theme metadata. We don't store details about each vulnerability - only link(s) to the original disclosure URL(s).

This can best be thought of as a vulnerability metabase.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

## Who is this for?

The app is designed to help WordPress hosting providers collate and manage WP plugin vulnerabilities across their clients' sites. If you want your VULNZ installation to be publicly accessible, you can host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

![List of websites](assets/v1.3.0/vulnz-dashboard-your-websites.png 'Websites managed in VULNZ')

![Reporting and API Keys](assets/v1.3.0/vulnz-reporting-and-api-keys.png 'Reporting and API Key management')

## Documentation

- **[Development Setup](docs/development.md)** - Get VULNZ running on your local development machine
- **[Production Deployment](docs/deployment.md)** - Deploy VULNZ to a production server
- **[Reverse Proxy Setup](docs/reverse-proxy.md)** - Configure Apache or Nginx with SSL/TLS
- **[Wordfence Feed Importer](docs/wordfence-importer.md)** - Automatically import vulnerabilities from Wordfence
- **[API Usage](docs/api-usage.md)** - REST API examples and documentation
- **[WordPress Plugin](docs/wordpress-plugin.md)** - WordPress plugin to sync sites with VULNZ
- **[Roadmap](docs/roadmap.md)** - Planned features and security enhancements

## Quick Start

```bash
# Clone and install
git clone https://github.com/headwalluk/vulnz
cd vulnz
npm install

# Configure
cp env.sample .env
# Edit .env with your database credentials

# Run in development
npm run dev
```

Visit `http://localhost:3000` and register your first user (will be granted admin privileges in setup mode).

For detailed instructions, see the [Development Setup](docs/development.md) guide.

## Requirements

- Node: v22+ recommended
- MySQL/MariaDB

## Upgrading

When updating to a new version of VULNZ, follow these steps:

```bash
# Stop the application
pm2 stop vulnz

# Pull the latest code
git pull

# Check for new environment variables
# Compare your .env with env.sample and add any new required settings

# Install dependencies (use ci for production)
npm ci

# Build production assets
npm run build

# Restart the application
pm2 start ./ecosystem.config.js
```

**Important notes:**
- Database migrations run automatically on application startup
- Always review the CHANGELOG for breaking changes
- Test in a staging environment before deploying to production
- Back up your database before upgrading

## Project Tracking

### Version 1.10.0 - Security Monitoring & Enhanced Reporting

**Status**: Planning Phase  
**Target Release**: TBD

#### Overview
Transform VULNZ from a vulnerability tracking system into a comprehensive security monitoring platform. This release adds security event logging, version tracking, static code analysis integration, component change auditing, and dramatically enhanced weekly reports.

#### New Features

##### 1. Security Events Logging
Track security-relevant events from monitored websites including failed logins, user enumeration attempts, vulnerability probes, and more. Events include geographic context (continent/country) via GeoIP lookup.

**Documentation**: [docs/security-events.md](docs/security-events.md)

- [x] Create `security_event_types` model and table
- [x] Create `security_events` model and table
- [x] Implement GeoIP integration (MaxMind GeoLite2)
- [x] Add `POST /api/websites/:id/security-events` endpoint
- [x] Add security events retention/purge cron job
- [x] Add environment variables for configuration
- [ ] Write tests for security event recording
- [ ] Document API endpoints

##### 2. Version Tracking
Monitor WordPress core, PHP, and database server versions across all websites. Alert on outdated software with known vulnerabilities.

**Documentation**: [docs/version-tracking.md](docs/version-tracking.md)

- [x] Add version fields to `websites` table (ALTER TABLE)
- [x] Update `Website` model with version methods
- [x] Add `PUT /api/websites/:id/versions` endpoint
- [x] Update `GET /api/websites/:id` to include versions
- [x] Implement version comparison logic (semver)
- [x] Add version status queries for reporting
- [x] Add environment variables for current/recommended versions
- [ ] Write tests for version tracking
- [ ] Document API endpoints

##### 3. Static Analysis Integration
Store results from PHP security scanning tools (PHP_CodeSniffer, etc.) to identify code-level security issues in WordPress files.

**Documentation**: [docs/static-analysis.md](docs/static-analysis.md)

- [x] Create `file_security_issues` model and table
- [x] Implement touch-based purging logic
- [x] Add `POST /api/websites/:id/security-scan` endpoint
- [ ] Add `GET /api/websites/:id/security-issues` endpoint (future)
- [x] Create sample scanner script (`scripts/scan-website.sh`)
- [ ] Create results parser script (`scripts/post-analysis-results.js`)
- [x] Add retention/purge cron job for stale issues
- [ ] Write tests for scan result processing
- [ ] Document sample script setup and usage

##### 4. Component Changes Tracking
Audit trail of plugin/theme additions, removals, and version updates with security context.

**Documentation**: [docs/component-changes.md](docs/component-changes.md)

- [x] Create `component_changes` model and table
- [x] Implement `ComponentChange.recordChanges()` method
- [x] Update `processComponents()` in websites route to record changes
- [x] Add component change queries for reporting
- [x] Add retention/purge cron job
- [x] Include change summary in API responses
- [ ] Write tests for change detection
- [ ] Document change tracking behavior

##### 5. Enhanced Weekly Reports
Comprehensive weekly security reports including all new data sources with actionable recommendations.

**Documentation**: [docs/enhanced-reporting.md](docs/enhanced-reporting.md)

- [x] Update report data collection in `src/lib/reporting.js`
- [x] Add queries for security events summary
- [x] Add queries for version status
- [x] Add queries for static analysis results
- [x] Add queries for component changes
- [x] Create/update Handlebars email templates
- [x] Add system-level report configuration
- [x] Implement color coding and severity indicators
- [ ] Add error handling for partial report generation
- [x] Test with sample data
- [x] Update report sending logic

##### 6. Database & Infrastructure
- [x] Create database migration script for new tables
- [x] Add indexes for performance optimization
- [x] Update cron jobs in `src/lib/cron.js`
- [x] Add new environment variables to `.env.sample`
- [x] Update documentation with new config options
- [x] Test database migrations on fresh install
- [x] Test database migrations on existing data

##### 7. Testing & Documentation
- [ ] Write unit tests for new models
- [ ] Write integration tests for new API endpoints
- [ ] Write tests for report generation
- [ ] Update API documentation (Swagger)
- [ ] Update main README with new features
- [ ] Create upgrade guide from v1.x to v2.0
- [ ] Document breaking changes (if any)

##### 8. Release
- [ ] Version bump to 1.10.0
- [ ] Update CHANGELOG
- [ ] Tag release in git
- [ ] Create GitHub release with notes
- [ ] Announce release

#### Dependencies
- **MaxMind GeoLite2** - IP geolocation database
- **semver** - Semantic version comparison
- Additional dev dependencies as needed

#### Configuration Changes
New environment variables required:
```bash
SECURITY_EVENTS_RETENTION_DAYS=30
GEOIP_DATABASE_PATH=/path/to/GeoLite2-City.mmdb
FILE_SECURITY_ISSUES_RETENTION_DAYS=30
COMPONENT_CHANGES_RETENTION_DAYS=365
WORDPRESS_STABLE_VERSION=6.4.2
PHP_MINIMUM_VERSION=8.1.0
PHP_RECOMMENDED_VERSION=8.3.0
```

---

### Version 1.11.0 - App Settings

**Status**: Planning Phase  
**Target Release**: TBD

#### Overview
Move runtime configuration from environment variables to a database-backed key-value store. This provides a centralized, typed configuration system for version thresholds, retention periods, feature flags, and operational settings without requiring application restarts.

**Documentation**: [docs/app-settings.md](docs/app-settings.md)

#### Features

##### 1. Database Schema
- [x] Create migration for `app_settings` table
- [x] Add indexes for category and is_system fields
- [x] Define ENUM for value types (string, integer, float, boolean)
- [x] Test migration on fresh install
- [x] Test migration on existing database

##### 2. AppSetting Model
- [x] Create `src/models/AppSetting.js`
- [x] Implement `get(key)` with type casting
- [x] Implement `set(key, value, type, description, category, isSystem)`
- [x] Implement `getAll(category)` query
- [x] Implement `delete(key)` with system setting protection
- [x] Implement `getByCategory(category)` query
- [x] Add validation for value types
- [ ] Write unit tests for model methods

##### 3. REST API Endpoints
- [x] Add `GET /api/settings` - List all settings (auth required)
- [x] Add `GET /api/settings/:key` - Get single setting (auth required)
- [x] Add `PUT /api/settings/:key` - Update setting (admin only)
- [x] Add `DELETE /api/settings/:key` - Delete setting (admin only, non-system)
- [x] Add middleware for admin-only write protection
- [x] Add validation for setting keys (dot-namespaced)
- [x] Add validation for value types
- [ ] Write integration tests for endpoints
- [x] Document API endpoints

##### 4. Default Settings Seeding
- [x] Create seeding script for initial settings
- [x] Seed WordPress version settings
- [x] Seed PHP version settings
- [x] Seed database version settings
- [x] Seed retention period settings
- [x] Seed batch and rate limit settings
- [x] Use `INSERT IGNORE` for idempotent seeding
- [x] Test seeding on fresh install
- [x] Document seeded defaults

##### 5. Migration from Environment Variables
- [x] Identify settings to migrate from `.env`
- [x] Update `src/lib/reporting.js` to use AppSetting
- [x] Update `src/lib/cron.js` to use AppSetting
- [x] Update `src/models/Website.js` version checks
- [x] Update any other code using version constants
- [x] Maintain backwards compatibility with `.env` as fallback
- [x] Add deprecation warnings for old env vars
- [x] Update `.env.sample` with migration notes
- [x] Document migration process

##### 6. Admin UI (Future)
- [ ] Design settings management interface
- [ ] Add settings page to admin panel
- [ ] Group settings by category
- [ ] Add inline editing for settings
- [ ] Add validation feedback
- [ ] Add search/filter for settings
- [ ] Show setting descriptions and types

##### 7. Reference Data Updates
- [x] Create `src/lib/referenceData.js`
- [x] Support URL and file methods for fetching reference data
- [x] Add semver validation
- [x] Add graceful error handling
- [x] Add twice-daily cron job (11am/11pm GMT)
- [x] Run on server startup
- [x] Create `data/reference.json` for development
- [x] Add `REFERENCE_UPDATE_METHOD` and `REFERENCE_UPDATE_LOCATION` to env.sample
- [x] Document reference data system

##### 8. Testing & Documentation
- [x] Test type casting (string, integer, float, boolean)
- [x] Test admin-only write protection
- [x] Test system setting deletion protection
- [x] Update API documentation (Swagger)
- [x] Document setting key naming conventions
- [ ] Write unit tests for AppSetting model
- [ ] Write integration tests for API endpoints
- [ ] Create migration guide for users

##### 9. Release
- [x] Version bump to 1.11.0
- [x] Update CHANGELOG
- [x] Tag release in git
- [ ] Create GitHub release with notes
- [ ] Announce release

#### Configuration Migration
Settings to migrate from `.env` to database:
- `WORDPRESS_STABLE_VERSION` → `wordpress.current_version`
- `PHP_MINIMUM_VERSION` → `php.minimum_version`
- `PHP_RECOMMENDED_VERSION` → `php.recommended_version`
- `SECURITY_EVENTS_RETENTION_DAYS` → `retention.security_events_days`
- `FILE_SECURITY_ISSUES_RETENTION_DAYS` → `retention.file_security_issues_days`
- `COMPONENT_CHANGES_RETENTION_DAYS` → `retention.component_changes_days`

---

## License

[MIT](./LICENSE)
