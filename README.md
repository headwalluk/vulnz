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

## License

[MIT](./LICENSE)
