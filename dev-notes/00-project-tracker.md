# VULNZ Project Tracker

Active development tracking for VULNZ features and releases.

---

## Current Version: 1.21.4

**Status**: Production  
**Last Updated**: January 27, 2026

### Known Issues

#### ✅ User Creation API Failure (FIXED)

**Discovered**: January 13, 2026  
**Fixed**: January 13, 2026  
**Priority**: High

**Issue**: Creating new users via the API failed with:

```
sqlMessage: "Column 'enable_white_label' cannot be null"
```

**Resolution**: Updated `enable_white_label` normalization logic in [src/models/user.js](../src/models/user.js) to use explicit boolean conversion (`enable_white_label ? true : false`), ensuring `null` and `undefined` values are always converted to `false` before database insertion.

---

### Recent Changes

- **Test Suite Overhaul**: Achieved complete test coverage with 114/114 passing tests
  - All API test suites now authentic to production behavior
  - Fixed authentication, schema mismatches, and database compatibility issues
  - Test infrastructure now stable and reliable for ongoing development
- Project is stable and running in production
- Documentation reorganization in progress
- Planning CLI tool for administrative operations

---

## Project Milestones

### Milestone 1: CLI Administration Tool

**Status**: Planning  
**Priority**: High  
**Target**: Q1 2026  
**Dependencies**: Complete API testing, documentation review

#### Objectives

Replace web-based admin UI with command-line tools for all administrative operations. This enables better automation, reduces attack surface, and prepares for API-first architecture.

#### Tasks

- [ ] **Architecture & Design**
  - [ ] Review all admin UI operations and map to CLI commands
  - [ ] Design CLI command structure and naming conventions
  - [ ] Choose CLI framework (Commander.js, Yargs, or similar)
  - [ ] Plan configuration file format (e.g., `.vulnzrc`)
  - [ ] Design output formats (table, JSON, CSV)

- [ ] **Core CLI Implementation**
  - [ ] Set up CLI project structure and build system
  - [ ] Implement authentication (API key from config or ENV)
  - [ ] Create base command structure and help system
  - [ ] Add global flags (--verbose, --json, --config)
  - [ ] Implement error handling and user-friendly messages

- [ ] **User Management Commands**
  - [ ] `vulnz users list` - List all users with filtering
  - [ ] `vulnz users show <id>` - Show user details
  - [ ] `vulnz users create <email>` - Create new user
  - [ ] `vulnz users update <id>` - Update user properties
  - [ ] `vulnz users delete <id>` - Delete user
  - [ ] `vulnz users block <id>` / `unblock <id>` - Block/unblock users
  - [ ] `vulnz users pause <id>` / `unpause <id>` - Pause/unpause users

- [ ] **Website Management Commands**
  - [ ] `vulnz websites list` - List websites with filtering
  - [ ] `vulnz websites show <domain>` - Show website details
  - [ ] `vulnz websites create <domain>` - Create website
  - [ ] `vulnz websites update <domain>` - Update website
  - [ ] `vulnz websites delete <domain>` - Delete website
  - [ ] `vulnz websites transfer <domain> --to-user=<id>` - Change ownership

- [ ] **API Key Management Commands**
  - [ ] `vulnz api-keys list [--user=<id>]` - List API keys
  - [ ] `vulnz api-keys create --user=<id> --name="Name"` - Create key
  - [ ] `vulnz api-keys revoke <key>` - Revoke API key

- [ ] **Component Management Commands**
  - [ ] `vulnz components list` - List components
  - [ ] `vulnz components show <slug>` - Show component details
  - [ ] `vulnz components create` - Create component
  - [ ] `vulnz components sync` - Sync with wordpress.org

- [ ] **Reporting Commands**
  - [ ] `vulnz reports send --user=<id>` - Send report immediately
  - [ ] `vulnz reports preview --user=<id>` - Preview report content
  - [ ] `vulnz reports test-email <address>` - Test email delivery

- [ ] **Database Utilities**
  - [ ] `vulnz db migrate` - Run pending migrations
  - [ ] `vulnz db rollback` - Rollback last migration
  - [ ] `vulnz db seed` - Seed database with test data
  - [ ] `vulnz db backup` - Create database backup

- [ ] **Settings Management**
  - [ ] `vulnz settings list` - List all settings
  - [ ] `vulnz settings get <key>` - Get setting value
  - [ ] `vulnz settings set <key> <value>` - Update setting

- [ ] **Testing & Documentation**
  - [ ] Write unit tests for CLI commands
  - [ ] Write integration tests against API
  - [ ] Create CLI user guide documentation
  - [ ] Add command examples and recipes
  - [ ] Create migration guide from web UI to CLI

- [ ] **Distribution**
  - [ ] Set up npm package for CLI
  - [ ] Configure executable binary
  - [ ] Add installation instructions
  - [ ] Create release workflow

#### Success Criteria

- All admin operations available via CLI
- CLI has comprehensive help system
- All commands have tests
- Documentation complete
- Web admin UI can be safely removed

---

### Milestone 2: Enhanced Reporting & White-Labeling

**Status**: Planning  
**Priority**: High  
**Target**: Q2 2026  
**Dependencies**: Database schema updates, email template redesign

#### Objectives

Enable agencies to manage multiple clients with grouped websites, custom branding, and targeted report delivery. Support both user-level and application-level white-labeling.

#### Tasks

- [ ] **Database Schema Updates**
  - [ ] Add `client_email` column to `websites` table
  - [ ] Add `client_name` column to `websites` table (optional display name)
  - [ ] Add `application_white_label_html` to `app_settings` table
  - [ ] Add `application_white_label_enabled` to `app_settings` table
  - [ ] Create migration for new columns
  - [ ] Add indexes for client_email queries

- [ ] **Client Grouping Logic**
  - [ ] Update website model to support client_email
  - [ ] Create query to group websites by client_email
  - [ ] Build logic to generate separate reports per client
  - [ ] Ensure main user still receives aggregate report

- [ ] **White-Labeling System**
  - [ ] Design white-label template system (user-level and app-level)
  - [ ] Create fallback hierarchy (user → application → default)
  - [ ] Add HTML sanitization for white-label content
  - [ ] Update email template to inject white-label HTML
  - [ ] Create preview system for white-label content

- [ ] **API Endpoints**
  - [ ] Add `client_email` and `client_name` to website create/update endpoints
  - [ ] Create endpoint to list websites grouped by client
  - [ ] Create endpoint to manage application-level white-label settings
  - [ ] Add white-label preview endpoint

- [ ] **Reporting Engine Updates**
  - [ ] Update report generator to handle client grouping
  - [ ] Generate separate emails for each client_email group
  - [ ] Include agency user in all client reports (BCC or separate email)
  - [ ] Apply correct white-label branding per report
  - [ ] Update email subject lines for client reports

- [ ] **CLI Commands**
  - [ ] `vulnz websites update <domain> --client-email=<email>`
  - [ ] `vulnz websites list --group-by-client`
  - [ ] `vulnz settings set application.white_label_html <html>`
  - [ ] `vulnz reports preview --client=<email>`

- [ ] **Testing**
  - [ ] Test client grouping logic
  - [ ] Test white-label template rendering
  - [ ] Test report generation for multiple clients
  - [ ] Test fallback behavior
  - [ ] Integration tests for full reporting workflow

- [ ] **Documentation**
  - [ ] Document client grouping feature
  - [ ] Create white-labeling guide
  - [ ] Add example white-label HTML templates
  - [ ] Update API documentation

#### Success Criteria

- Agencies can assign websites to client emails
- Separate reports generated per client group
- White-labeling works at user and application level
- Main user receives aggregate report
- All features accessible via CLI and API

---

### Milestone 3: UI Simplification

**Status**: Planning  
**Priority**: Medium  
**Target**: Q2 2026  
**Dependencies**: Milestone 1 (CLI tool) complete

#### Objectives

Remove admin UI to reduce attack surface and complexity. Replace with simple, configurable front page for public search or static content.

#### Tasks

- [ ] **Planning & Preparation**
  - [ ] Audit all admin UI functionality (ensure CLI equivalents exist)
  - [ ] Document migration path for current admin users
  - [ ] Design new front page options/configurations
  - [ ] Plan URL structure for simplified site

- [ ] **Remove Admin UI**
  - [ ] Remove `/admin` routes and controllers
  - [ ] Remove admin HTML pages and assets
  - [ ] Remove admin-specific middleware
  - [ ] Update authentication to remove session-based admin access
  - [ ] Clean up unused CSS/JS for admin UI

- [ ] **Front Page Options**
  - [ ] Create configurable front page system
  - [ ] Option 1: Public search interface (current index.html)
  - [ ] Option 2: Static placeholder page
  - [ ] Option 3: Custom HTML content (from app_settings)
  - [ ] Add setting to choose front page type

- [ ] **Public Search Interface (if enabled)**
  - [ ] Keep existing search functionality
  - [ ] Remove authentication requirement
  - [ ] Simplify design (remove logged-in user elements)
  - [ ] Add rate limiting for unauthenticated searches

- [ ] **Configuration**
  - [ ] Add `FRONT_PAGE_TYPE` to environment variables
  - [ ] Add `FRONT_PAGE_CUSTOM_HTML` to app_settings
  - [ ] Create CLI command to set front page type
  - [ ] Create example custom HTML templates

- [ ] **Testing & Migration**
  - [ ] Test each front page type
  - [ ] Create migration guide for existing installations
  - [ ] Update installation documentation
  - [ ] Notify users of upcoming changes

- [ ] **Cleanup**
  - [ ] Remove unused dependencies
  - [ ] Update package.json
  - [ ] Clean up database schema (remove unused tables/columns)
  - [ ] Archive old admin UI code to separate branch

#### Success Criteria

- Admin UI completely removed
- CLI tool handles all admin operations
- Front page is configurable and working
- Documentation updated
- Attack surface significantly reduced

---

### Milestone 4: Modern SPA Admin UI (Optional)

**Status**: Future / On Hold  
**Priority**: Low  
**Target**: TBD  
**Dependencies**: Milestones 1-3 complete

#### Objectives

Build modern, decoupled admin UI as single-page application (SPA) using React or similar framework. This is **optional** and may not be pursued.

#### Decision Points

- [ ] Evaluate if CLI tool is sufficient for admin operations
- [ ] Assess user feedback on CLI-only approach
- [ ] Determine if SPA provides enough value to justify development
- [ ] Consider maintenance burden of separate SPA codebase

#### Tasks (If Pursued)

- [ ] **Planning**
  - [ ] Choose frontend framework (React, Vue, Svelte)
  - [ ] Design component architecture
  - [ ] Plan state management approach
  - [ ] Design UI/UX (wireframes, mockups)

- [ ] **Infrastructure**
  - [ ] Set up separate repository for SPA
  - [ ] Configure build system (Vite, Webpack)
  - [ ] Set up development environment
  - [ ] Configure CORS for API access

- [ ] **Core Features**
  - [ ] Authentication (API key or OAuth)
  - [ ] User management interface
  - [ ] Website management interface
  - [ ] API key management
  - [ ] Reports management
  - [ ] Settings management

- [ ] **Advanced Features**
  - [ ] Real-time updates (WebSockets)
  - [ ] Bulk operations
  - [ ] Advanced filtering and search
  - [ ] Data visualization (charts, graphs)
  - [ ] Dark mode

- [ ] **Deployment**
  - [ ] Create static build process
  - [ ] Set up hosting (can be served by main app or separate CDN)
  - [ ] Configure CI/CD pipeline
  - [ ] Create deployment documentation

#### Success Criteria (If Pursued)

- Modern, responsive admin interface
- Feature parity with CLI tool
- Excellent UX for non-technical users
- Fully decoupled from backend (API-only communication)
- Comprehensive documentation

---

### Milestone 5: Multi-Ecosystem Support

**Status**: Planning  
**Priority**: High  
**Target**: Q2-Q3 2026 (May run parallel to Milestone 2)  
**Dependencies**: None (can start immediately)  
**Planning Document**: [dev-notes/09-multi-platform-support.md](./09-multi-platform-support.md)

#### Objectives

Expand VULNZ beyond WordPress to support vulnerability tracking for multiple component ecosystems: npm (Node.js packages), PyPI (Python packages), Composer (PHP packages), and others. Transform VULNZ into a universal vulnerability monitoring platform.

**Primary Use Case:** Enable hosting providers to monitor both WordPress websites and Node.js applications for their customers, delivering unified weekly reports across all ecosystems. Customers running outdated Node.js dependencies represent significant security risk and business opportunity.

#### Key Terminology

- **Ecosystem** = Component ecosystem (wordpress, npm, pypi, composer)
  - Defines what components/packages we track
  - Links to vulnerability databases and metadata sources
- **Platform** = Runtime/infrastructure details (WordPress 6.9, Node.js 20.0.0, Python 3.11)
  - Stored as flexible JSON metadata per website
  - Each ecosystem defines its own platform metadata structure

#### Architecture Decisions ✅ RESOLVED

**Website-Ecosystem Relationship:**

- ✅ One ecosystem per website (simple, maintainable)
- ✅ No hybrid website support initially (edge case, adds complexity)
- ✅ Platform metadata stored as JSON (flexible, no schema changes needed)

**Database Structure:**

- ✅ New `ecosystems` table with JSON configuration
- ✅ `component_types` linked to ecosystems
- ✅ `websites` table gets `ecosystem_id` and `platform_metadata` JSON field

**Vulnerability Sources:**

- ✅ WordPress: Wordfence feed (existing)
- ✅ npm: OSV.dev API (Google's Open Source Vulnerabilities database)
- ✅ Future ecosystems: OSV.dev covers PyPI, Maven, Go, etc.

**Processing Strategy:**

- ✅ Separate feed processor scripts per ecosystem
- ✅ Batch API queries (not full database downloads)
- ✅ External scripts like existing Wordfence processor

#### Tasks

- [ ] **Phase 0: API Versioning (HIGH PRIORITY - Do First)**
  - [ ] Design API versioning strategy (/api/v1, /api/v2)
  - [ ] Create v2 API structure with ecosystem support
  - [ ] Maintain v1 API endpoints (WordPress-only format)
  - [ ] Add deprecation warnings to v1 API responses
  - [ ] Update API documentation for both versions
  - [ ] Update vulnz-agent WordPress plugin to use v2 API
  - [ ] Update internal scripts to use v2 API
  - [ ] Test backward compatibility (v1 still works)
  - [ ] Set deprecation timeline for v1 (e.g., 12 months)

- [ ] **Phase 1: Database Schema**
  - [ ] Create `ecosystems` table with JSON data field
  - [ ] Add `ecosystem_id` to `component_types` table
  - [ ] Add `ecosystem_id` and `platform_metadata` JSON to `websites` table
  - [ ] Add `severity` ENUM to `vulnerabilities` table (unknown, medium, high)
  - [ ] Create migration script with rollback capability
  - [ ] Seed ecosystems: wordpress, npm, pypi
  - [ ] Migrate existing WordPress websites to new structure
  - [ ] Add component types: npm-package, pypi-package
  - [ ] Test migration on development database
  - [ ] Update indexes for ecosystem queries

- [ ] **Phase 2: API Updates**
  - [ ] Update POST /api/websites to accept ecosystem and platform metadata
  - [ ] Maintain backward compatibility with old WordPress-only format
  - [ ] Update GET /api/websites to return ecosystem information
  - [ ] Add filtering by ecosystem to website endpoints
  - [ ] Update component endpoints to handle ecosystem filtering
  - [ ] Create GET /api/ecosystems endpoint
  - [ ] Add validation for ecosystem-specific data
  - [ ] Update API documentation
  - [ ] Write integration tests for new API format

- [ ] **Phase 3: npm Ecosystem Support**
  - [ ] Research OSV.dev API for npm vulnerabilities
  - [ ] Create `scripts/process-npm-vulnerabilities.sh`
  - [ ] Implement batch querying of OSV.dev (100 packages at a time)
  - [ ] Map OSV.dev vulnerability data to Vulnz schema
  - [ ] Extract and map CVSS scores to severity levels (high/medium/unknown)
  - [ ] Update Wordfence processor to extract/map severity levels
  - [ ] Test vulnerability processing with real npm packages
  - [ ] Add cron schedule for daily npm vulnerability updates
  - [ ] (Optional) Implement npm registry metadata sync
  - [ ] Document npm integration for users
  - [ ] Create example API payloads for npm websites

- [ ] **Phase 4: Reporting Updates**
  - [ ] Create component type label mapping (plugin, package, theme, gem)
  - [ ] Implement dynamic summary generation (single vs multi-ecosystem)
  - [ ] Add severity-based highlighting (high = red, medium = orange)
  - [ ] Sort vulnerabilities by severity (high first, then medium)
  - [ ] Update email template to handle ecosystem-specific sections
  - [ ] Add ecosystem-aware terminology in report copy
  - [ ] Test WordPress-only client reports (no npm data shown)
  - [ ] Test npm-only client reports (no WordPress data shown)
  - [ ] Test mixed ecosystem client reports (grouped sections)
  - [ ] Ensure zero-click, non-scary presentation preserved
  - [ ] Verify white-labeling still works
  - [ ] Add ecosystem icons/branding to reports

- [ ] **Phase 5: CLI Updates** (if Milestone 1 complete)
  - [ ] `vulnz ecosystems list` - Show supported ecosystems
  - [ ] `vulnz websites create --ecosystem=npm` - Create ecosystem-specific website
  - [ ] `vulnz components list --ecosystem=npm` - Filter by ecosystem
  - [ ] Update existing CLI commands to support ecosystem parameter
  - [ ] Add ecosystem validation to CLI inputs

- [ ] **Phase 6: Testing & Validation**
  - [ ] Test WordPress website creation (existing functionality)
  - [ ] Test npm website creation with components
  - [ ] Test vulnerability detection for npm packages
  - [ ] Test mixed user with both WordPress and npm sites
  - [ ] Test backward compatibility with old API format
  - [ ] Load test with hundreds of npm packages
  - [ ] Validate migration on production backup
  - [ ] Test rollback procedure

- [ ] **Phase 7: Documentation**
  - [ ] Update API documentation with ecosystem examples
  - [ ] Create user guide for npm monitoring
  - [ ] Document ecosystem data structure and configuration
  - [ ] Add migration guide for existing WordPress installations
  - [ ] Create troubleshooting guide for ecosystem issues
  - [ ] Document vulnerability feed processing for each ecosystem

- [ ] **Phase 8: Rollout**
  - [ ] Deploy database migration to staging
  - [ ] Test all functionality in staging
  - [ ] Deploy to production during maintenance window
  - [ ] Monitor for errors and issues
  - [ ] AnnouncEcosystems (Planned)

**Phase 1 (Initial - Q2 2026):**

- ✅ WordPress (wordpress-plugin, wordpress-theme) - _Production_
- 🚀 npm (npm-package) - **_Priority: High customer demand_**

**Phase 2 (Expansion - Q3-Q4 2026):**

- 🔄 PyPI (pypi-package) - Python packages
- 🔄 Composer (composer-package) - PHP packages

**Future Consideration:**

- RubyGems (rubygems-package)
- Maven (maven-package)
- Go Modules (go-module)
- Cargoe 2 (Expansion - Q3-Q4 2026):\*\*
- 🔄 Python (pip-package)
- 🔄 PHP (composer-package)

**Future Consideration:**

- Django (django-package)
- Joomla (joomla-extension)
- Ruby (rubygems-package)
- Go (go-module)
- Rust (cargo-package)

#### Real-World Impact

**Hosting Provider Scenario:**

- Monitor 50 WordPress sites + 15 Node.js apps for customers
- Weekly report shows: "Client ABC has 3 WordPress sites (2 vulnerable plugins) and 1 Node.js app (8 outdated packages with CVEs)"
- Client receives white-labeled report with hosting company branding
- Hosting provider can proactively contact clients about security issues
- Reduces support burden from compromised sites
- Demonstrates value-add security monitoring service

**Pain Points Addressed:**

- Customers necosystems supported (WordPress + npm)
- Vulnerability tracking accurate for both ecosystems
- Reports dynamically adapt to client's ecosystems (no irrelevant data)
- Zero-click, non-scary report format preserved
- API accepts ecosystem and platform metadata
- Backward compatible with existing WordPress-only API
- Vulnerability feeds processed for each ecosystem (daily)
- Migration path tested and documented
- Documentation comprehensive (API, user guides, troubleshooting)
- At least 2 platforms supported (WordPress + one other)
- Platform detection works reliably
- Vulnerability tracecosystems have different vulnerability disclosure formats  
  **Mitigation:** Use OSV.dev as unified source (covers npm, PyPI, etc.); focus on linking to authoritative sources

**Risk:** npm packages number in the hundreds per website (vs dozens for WordPress)  
**Mitigation:** Batch API queries (100 at a time); only query for packages we're tracking

**Risk:** Vulnerability APIs may have rate limits or access restrictions  
**Mitigation:** Batch queries, respect rate limits, daily processing (not on-demand)

**Risk:** Complexity increases maintenance burden  
**Mitigation:** Simple architecture (one ecosystem per website), comprehensive tests, clear documentation

**Risk:** Reporting becomes cluttered with multi-ecosystem data  
**Mitigation:** Dynamic summary generation - only show relevant ecosystem data per client

**Risk:** Breaking changes to existing WordPress-only users  
**Mitigation:** Maintain backward compatibility; old API format still works; migration is transparentthoritative sources

**Risk:** Platform APIs may have rate limits or access restrictions
**Mitigation:** Implement caching, respect rate limits, provide manual import options

**Risk:** Complexity increases maintenance burden
**Mitigation:** Strong plugin architecture, comprehensive tests, clear documentation

**Risk:** Community expectations for "all platforms"
**Mitigation:** Be explicit about supported platforms, roadmap for additions

---

## Version History

For detailed version history, see [CHANGELOG.md](../CHANGELOG.md).

---

## Development Workflow

1. Create feature branch from `main`
2. Implement changes with tests
3. Update this tracker with progress
4. Submit PR for review
5. Merge to main and deploy
6. Update version in package.json
7. Tag release in git

---

## Development Practices

### Test Coverage Review Schedule

**Review test coverage monthly** to ensure new features and endpoints are properly tested.

- Run `npm test` to verify all tests passing
- Check [dev-notes/08-test-coverage-analysis.md](./08-test-coverage-analysis.md) for coverage status
- Update coverage analysis document when adding new endpoints
- Prioritize testing for:
  - Authentication/authorization flows (security critical)
  - CRUD operations for core resources (data integrity)
  - API endpoints used by external integrations (breaking changes)
  - Complex business logic (vulnerability detection, scanning)

**Note:** Web UI tests are deprioritized as the admin UI will be replaced with a CLI tool in Q1 2026.

### Code Review Checklist

- [ ] Security: All user inputs sanitized
- [ ] Security: All SQL queries parameterized
- [ ] Authentication: Endpoints have proper auth middleware
- [ ] Authorization: Role checks where needed
- [ ] Validation: Input validation implemented
- [ ] Error handling: Try-catch blocks with appropriate responses
- [ ] Logging: API calls logged where appropriate
- [ ] Testing: Unit/integration tests added/updated
- [ ] Documentation: Swagger docs updated if API changed

---

## Next Steps

- [ ] Complete documentation reorganization (dev-notes/ and docs/)
- [ ] Review and improve test coverage for API routes
- [ ] Plan CLI tool architecture
- [ ] Audit security patterns across codebase
- [ ] Plan React SPA for future admin interface
