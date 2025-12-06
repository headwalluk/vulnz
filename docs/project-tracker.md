# VULNZ Project Tracker

Active development tracking for VULNZ features and releases.

---

## Version 1.10.0 - Security Monitoring & Enhanced Reporting

**Status**: Released  
**Release Date**: December 2025

### Overview
Transform VULNZ from a vulnerability tracking system into a comprehensive security monitoring platform. This release adds security event logging, version tracking, static code analysis integration, component change auditing, and dramatically enhanced weekly reports.

### New Features

#### 1. Security Events Logging
Track security-relevant events from monitored websites including failed logins, user enumeration attempts, vulnerability probes, and more. Events include geographic context (continent/country) via GeoIP lookup.

**Documentation**: [docs/security-events.md](security-events.md)

- [x] Create `security_event_types` model and table
- [x] Create `security_events` model and table
- [x] Implement GeoIP integration (MaxMind GeoLite2)
- [x] Add `POST /api/websites/:id/security-events` endpoint
- [x] Add security events retention/purge cron job
- [x] Add environment variables for configuration
- [ ] Write tests for security event recording
- [ ] Document API endpoints

#### 2. Version Tracking
Monitor WordPress core, PHP, and database server versions across all websites. Alert on outdated software with known vulnerabilities.

**Documentation**: [docs/version-tracking.md](version-tracking.md)

- [x] Add version fields to `websites` table (ALTER TABLE)
- [x] Update `Website` model with version methods
- [x] Add `PUT /api/websites/:id/versions` endpoint
- [x] Update `GET /api/websites/:id` to include versions
- [x] Implement version comparison logic (semver)
- [x] Add version status queries for reporting
- [x] Add environment variables for current/recommended versions
- [ ] Write tests for version tracking
- [ ] Document API endpoints

#### 3. Static Analysis Integration
Store results from PHP security scanning tools (PHP_CodeSniffer, etc.) to identify code-level security issues in WordPress files.

**Documentation**: [docs/static-analysis.md](static-analysis.md)

- [x] Create `file_security_issues` model and table
- [x] Implement touch-based purging logic
- [x] Add `POST /api/websites/:id/security-scan` endpoint
- [ ] Add `GET /api/websites/:id/security-issues` endpoint (future)
- [x] Create sample scanner script (`scripts/scan-website.sh`)
- [ ] Create results parser script (`scripts/post-analysis-results.js`)
- [x] Add retention/purge cron job for stale issues
- [ ] Write tests for scan result processing
- [ ] Document sample script setup and usage

#### 4. Component Changes Tracking
Audit trail of plugin/theme additions, removals, and version updates with security context.

**Documentation**: [docs/component-changes.md](component-changes.md)

- [x] Create `component_changes` model and table
- [x] Implement `ComponentChange.recordChanges()` method
- [x] Update `processComponents()` in websites route to record changes
- [x] Add component change queries for reporting
- [x] Add retention/purge cron job
- [x] Include change summary in API responses
- [ ] Write tests for change detection
- [ ] Document change tracking behavior

#### 5. Enhanced Weekly Reports
Comprehensive weekly security reports including all new data sources with actionable recommendations.

**Documentation**: [docs/enhanced-reporting.md](enhanced-reporting.md)

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

#### 6. Database & Infrastructure
- [x] Create database migration script for new tables
- [x] Add indexes for performance optimization
- [x] Update cron jobs in `src/lib/cron.js`
- [x] Add new environment variables to `.env.sample`
- [x] Update documentation with new config options
- [x] Test database migrations on fresh install
- [x] Test database migrations on existing data

#### 7. Testing & Documentation
- [x] Write unit tests for new models
- [x] Write integration tests for new API endpoints
- [x] Write tests for report generation
- [x] Update API documentation (Swagger)
- [x] Update main README with new features
- [x] Create upgrade guide from v1.x to v2.0
- [x] Document breaking changes (if any)

#### 8. Release
- [x] Version bump to 1.10.0
- [x] Update CHANGELOG
- [x] Tag release in git
- [x] Create GitHub release with notes
- [x] Announce release

### Dependencies
- **MaxMind GeoLite2** - IP geolocation database
- **semver** - Semantic version comparison

### Configuration Changes
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

## Version 1.11.1 - Testing Infrastructure

**Status**: Released  
**Release Date**: December 6, 2025

### Overview
Establish comprehensive automated testing infrastructure to ensure API reliability and prevent regressions. Initial focus on Settings API with plans to expand coverage to all endpoints.

### Features

#### 1. Test Infrastructure Setup
- [x] Install Jest, Supertest, sqlite3, bcryptjs
- [x] Create `tests/setup.js` with test utilities
- [x] Implement in-memory SQLite database for test isolation
- [x] Build MySQL→SQLite syntax conversion layer
- [x] Configure Passport authentication for tests
- [x] Create Jest configuration with coverage thresholds
- [x] Add test scripts to package.json

#### 2. Settings API Test Suite
- [x] Write 21 comprehensive tests for Settings API
- [x] Test GET /api/settings (5 tests: list, filter, group, auth)
- [x] Test GET /api/settings/:key (3 tests: retrieve, 404, auth)
- [x] Test PUT /api/settings/:key (5 tests: create, update, admin-only, validation)
- [x] Test DELETE /api/settings/:key (5 tests: delete, protection, admin-only, 404)
- [x] Test type casting (3 tests: integer, boolean, float)
- [x] All 21 tests passing

#### 3. Documentation
- [x] Create `tests/README.md` with comprehensive testing guide
- [x] Document test architecture and database isolation
- [x] Provide examples for writing new tests
- [x] Add authentication testing patterns
- [x] Include best practices and troubleshooting
- [x] Update main README with testing section
- [x] Add tests badge to README
- [x] Create `docs/project-tracker.md` for centralized tracking

#### 4. Release
- [x] Version bump to 1.11.1
- [x] Update CHANGELOG
- [x] Commit and tag release
- [ ] Push to GitHub

### Test Coverage
- **Settings API**: 21/21 tests passing (100%)
- **Overall Project**: Baseline established for future expansion

---

## Version 1.11.0 - App Settings & Automated Reference Data

**Status**: Released  
**Release Date**: December 6, 2025

### Overview
Move runtime configuration from environment variables to a database-backed key-value store. This provides a centralized, typed configuration system for version thresholds, retention periods, feature flags, and operational settings without requiring application restarts. Includes automated reference data updates for version thresholds.

**Documentation**: [docs/app-settings.md](app-settings.md)

### Features

#### 1. Database Schema
- [x] Create migration for `app_settings` table
- [x] Add indexes for category and is_system fields
- [x] Define ENUM for value types (string, integer, float, boolean)
- [x] Test migration on fresh install
- [x] Test migration on existing database

#### 2. AppSetting Model
- [x] Create `src/models/AppSetting.js`
- [x] Implement `get(key)` with type casting
- [x] Implement `set(key, value, type, description, category, isSystem)`
- [x] Implement `getAll(category)` query
- [x] Implement `delete(key)` with system setting protection
- [x] Implement `getByCategory(category)` query
- [x] Add validation for value types
- [x] Write unit tests for model methods

#### 3. REST API Endpoints
- [x] Add `GET /api/settings` - List all settings (auth required)
- [x] Add `GET /api/settings/:key` - Get single setting (auth required)
- [x] Add `PUT /api/settings/:key` - Update setting (admin only)
- [x] Add `DELETE /api/settings/:key` - Delete setting (admin only, non-system)
- [x] Add middleware for admin-only write protection
- [x] Add validation for setting keys (dot-namespaced)
- [x] Add validation for value types
- [x] Write integration tests for endpoints (21/21 passing)
- [x] Document API endpoints (Swagger)

#### 4. Default Settings Seeding
- [x] Create seeding script for initial settings
- [x] Seed WordPress version settings
- [x] Seed PHP version settings
- [x] Seed database version settings
- [x] Seed retention period settings
- [x] Seed batch and rate limit settings
- [x] Use `INSERT IGNORE` for idempotent seeding
- [x] Test seeding on fresh install
- [x] Document seeded defaults

#### 5. Migration from Environment Variables
- [x] Identify settings to migrate from `.env`
- [x] Update `src/lib/reporting.js` to use AppSetting
- [x] Update `src/lib/cron.js` to use AppSetting
- [x] Update `src/models/Website.js` version checks
- [x] Update any other code using version constants
- [x] Maintain backwards compatibility with `.env` as fallback
- [x] Add deprecation warnings for old env vars
- [x] Update `.env.sample` with migration notes
- [x] Document migration process

#### 6. Reference Data Updates
- [x] Create `src/lib/referenceData.js`
- [x] Support URL and file methods for fetching reference data
- [x] Add semver validation
- [x] Add graceful error handling
- [x] Add twice-daily cron job (11am/11pm GMT)
- [x] Run on server startup
- [x] Create `data/reference.json` for development
- [x] Add `REFERENCE_UPDATE_METHOD` and `REFERENCE_UPDATE_LOCATION` to env.sample
- [x] Document reference data system

#### 7. Testing Infrastructure
- [x] Set up Jest + Supertest + SQLite test environment
- [x] Create in-memory database isolation for tests
- [x] Implement MySQL→SQLite syntax conversion layer
- [x] Write comprehensive Settings API test suite (21 tests)
- [x] Test authentication and authorization flows
- [x] Test type casting (string, integer, float, boolean)
- [x] Test admin-only write protection
- [x] Test system setting deletion protection
- [x] Create test documentation (`tests/README.md`)
- [ ] Add tests for v1.10.0 features

#### 8. Admin UI (Future)
- [ ] Design settings management interface
- [ ] Add settings page to admin panel
- [ ] Group settings by category
- [ ] Add inline editing for settings
- [ ] Add validation feedback
- [ ] Add search/filter for settings
- [ ] Show setting descriptions and types

#### 9. Release
- [x] Version bump to 1.11.0
- [x] Update CHANGELOG
- [x] Tag release in git (v1.10.0, v1.11.0)
- [x] Push to GitHub
- [x] Deploy to production
- [ ] Create GitHub release with notes
- [ ] Announce release

### Configuration Migration
Settings migrated from `.env` to database:
- `WORDPRESS_STABLE_VERSION` → `wordpress.current_version`
- `PHP_MINIMUM_VERSION` → `php.minimum_version`
- `PHP_RECOMMENDED_VERSION` → `php.recommended_version`
- `SECURITY_EVENTS_RETENTION_DAYS` → `retention.security_events_days`
- `FILE_SECURITY_ISSUES_RETENTION_DAYS` → `retention.file_security_issues_days`
- `COMPONENT_CHANGES_RETENTION_DAYS` → `retention.component_changes_days`

### Test Coverage
- **Settings API**: 21/21 tests passing
  - GET /api/settings (5 tests)
  - GET /api/settings/:key (3 tests)
  - PUT /api/settings/:key (5 tests)
  - DELETE /api/settings/:key (5 tests)
  - Type Casting (3 tests)

---

## Future Releases

### Version 1.12.0 - Expanded Test Coverage (Planned)
- [ ] Tests for Website API endpoints
- [ ] Tests for Security Events API
- [ ] Tests for Version Tracking API
- [ ] Tests for Component Changes tracking
- [ ] Tests for Static Analysis results
- [ ] Integration tests for cron jobs
- [ ] E2E tests for complete workflows

### Version 2.0.0 - Major Refactor (Planned)
- [ ] TypeScript migration
- [ ] GraphQL API alongside REST
- [ ] Real-time notifications (WebSockets)
- [ ] Multi-tenancy support
- [ ] Advanced RBAC system
- [ ] Plugin marketplace integration
