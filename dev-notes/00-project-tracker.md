# VULNZ Project Tracker

Active development tracking for VULNZ features and releases.

---

## Current Version: 1.21.2

**Status**: Production  
**Last Updated**: January 2, 2026

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

### Milestone 5: Multi-Platform Support

**Status**: Planning  
**Priority**: High  
**Target**: Q2-Q3 2026 (May run parallel to Milestone 2)  
**Dependencies**: Milestone 1 (CLI) complete, architecture review

#### Objectives

Expand VULNZ beyond WordPress to support vulnerability tracking for Node.js (npm), Python (pip/PyPI), Django, Joomla, and other platforms. Transform VULNZ into a universal vulnerability metabase.

**Primary Use Case:** Enable hosting providers to monitor both WordPress websites and Node.js applications for their customers, delivering unified weekly reports across all platforms. Customers running outdated Node.js dependencies represent significant security risk and business opportunity.

#### Strategic Assessment

**Current Architecture Analysis:**

✅ **Platform-agnostic core:**
- `component_types` table uses slug-based identification
- `components`, `releases`, `vulnerabilities` tables are generic
- API endpoints use neutral naming (`/api/components`)
- No WordPress-specific constraints in core schema

❌ **WordPress-specific elements:**
- Websites table assumes WordPress (`wordpress_version`, `php_version`, `db_server_type`)
- Component types only seeded with `wordpress-plugin`, `wordpress-theme`
- WordPress.org sync hardcoded in `src/lib/wporg.js`
- UI/reporting copy references WordPress exclusively
- No concept of website "platform type"

**Verdict:** Extension is feasible without major rewrite. WordPress-specific code is isolated and can be generalized.

#### Architecture Decisions

- [ ] **Decision: Website Platform Model**
  - [ ] Option A: Add `platform` ENUM to websites (wordpress, nodejs, django, joomla)
  - [ ] Option B: Create platform-specific website tables (wordpress_websites, nodejs_websites)
  - [ ] Option C: Generic website with platform-specific JSON metadata
  - [ ] Document chosen approach and rationale

- [ ] **Decision: Version Tracking Schema**
  - [ ] Option A: Platform-specific columns (wordpress_version, nodejs_version, python_version)
  - [ ] Option B: Generic JSON field for platform versions
  - [ ] Option C: Separate platform_versions table with key-value pairs
  - [ ] Document chosen approach and rationale

- [ ] **Decision: Component Sync Architecture**
  - [ ] Design plugin system for platform integrators
  - [ ] Define common interface for all platform sync modules
  - [ ] Plan error handling and rate limiting strategy

#### Tasks

- [ ] **Phase 1: Architecture & Planning**
  - [ ] Research npm registry API (for Node.js packages)
  - [ ] Research PyPI API (for Python packages)
  - [ ] Research Packagist API (for PHP/Composer packages)
  - [ ] Research vulnerability databases (Snyk, GitHub Advisory, CVE)
  - [ ] Design platform abstraction layer
  - [ ] Create migration plan for existing WordPress installations
  - [ ] Document platform plugin interface

- [ ] **Phase 2: Database Schema Updates**
  - [ ] Add `platform` field to websites table
  - [ ] Create platform-agnostic version tracking system
  - [ ] Add new component_types (npm-package, pip-package, composer-package)
  - [ ] Create migration scripts
  - [ ] Update indexes for multi-platform queries
  - [ ] Add platform-specific metadata fields

- [ ] **Phase 3: Platform Integrators**
  - [ ] Create base `PlatformIntegrator` class/interface
  - [ ] Refactor WordPress.org sync to use new interface
  - [ ] Implement npm registry integrator
  - [ ] Implement PyPI integrator
  - [ ] Implement Packagist integrator (optional)
  - [ ] Create vulnerability feed aggregator (CVE, GitHub, Snyk)

- [ ] **Phase 4: API Updates**
  - [ ] Update component endpoints to handle multiple platforms
  - [ ] Add platform filtering to search/list endpoints
  - [ ] Update website endpoints to accept platform type
  - [ ] Create platform-specific sync endpoints
  - [ ] Update vulnerability endpoints for multi-source data
  - [ ] Add platform statistics endpoints

- [ ] **Phase 5: Website Scanning Updates**
  - [ ] Design platform detection mechanism
  - [ ] Update scanner to detect Node.js projects (package.json)
  - [ ] Update scanner to detect Python projects (requirements.txt, Pipfile)
  - [ ] Update scanner to extract component versions per platform
  - [ ] Add platform-specific component matching logic

- [ ] **Phase 6: Reporting Engine**
  - [ ] Update report generator for multi-platform websites
  - [ ] Create platform-specific report sections
  - [ ] Add platform-aware vulnerability descriptions
  - [ ] Update email templates for multi-platform content
  - [ ] Add platform icons/branding to reports

- [ ] **Phase 7: CLI Commands**
  - [ ] `vulnz platforms list` - Show supported platforms
  - [ ] `vulnz platforms sync <platform>` - Sync specific platform
  - [ ] `vulnz websites create --platform=nodejs` - Create platform-specific website
  - [ ] `vulnz components list --platform=npm` - Filter by platform
  - [ ] Update existing commands to support platform filtering

- [ ] **Phase 8: Testing**
  - [ ] Test npm package tracking and vulnerability detection
  - [ ] Test PyPI package tracking
  - [ ] Test multi-platform websites
  - [ ] Test platform detection and scanning
  - [ ] Test cross-platform reporting
  - [ ] Integration tests for all platform integrators

- [ ] **Phase 9: Documentation**
  - [ ] Document supported platforms and limitations
  - [ ] Create platform integrator development guide
  - [ ] Update user documentation for multi-platform usage
  - [ ] Add examples for each platform type
  - [ ] Document migration from WordPress-only to multi-platform

- [ ] **Phase 10: Gradual Rollout**
  - [ ] Release with WordPress + npm support only
  - [ ] Gather feedback and iterate
  - [ ] Add Python/pip support in next release
  - [ ] Consider community contributions for additional platforms

#### Supported Platforms (Planned)

**Phase 1 (Initial - Q2 2026):**
- ✅ WordPress (wordpress-plugin, wordpress-theme) - *Production*
- 🚀 Node.js (npm-package) - ***Priority: High customer demand***

**Phase 2 (Expansion - Q3-Q4 2026):**
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
- Customers never update Node.js dependencies (worse than WordPress)
- No unified view across different platform types
- Manual tracking is error-prone and time-consuming
- npm packages have high vulnerability churn rate
- Hosting providers need to demonstrate security value

#### Success Criteria

- At least 2 platforms supported (WordPress + one other)
- Platform detection works reliably
- Vulnerability tracking accurate across platforms
- Reports clearly distinguish platform-specific issues
- CLI supports all platforms
- Documentation comprehensive
- Migration path for existing users documented
- Community can contribute new platform integrators

#### Risks & Mitigations

**Risk:** Different platforms have different vulnerability disclosure formats
**Mitigation:** Design flexible vulnerability schema; focus on linking to authoritative sources

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
