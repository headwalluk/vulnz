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

## Upcoming Features

### CLI Administration Tool

**Status**: Planning  
**Priority**: High  
**Target**: Q1 2026

#### Overview

Replace web-based admin UI with command-line tools for all administrative operations.

#### Goals

- Simplify deployment (reduce attack surface by removing admin web UI)
- Better automation support for bulk operations
- Cleaner separation between public search interface and admin functions
- Enable future React SPA development against API

#### Planned Commands

```bash
vulnz users list
vulnz users create <email> --role=administrator,user
vulnz users update <id> --blocked=true
vulnz users delete <id>

vulnz websites list
vulnz websites create <domain> --user=<id>
vulnz websites update <id> --title="New Title"
vulnz websites delete <id>

vulnz api-keys list
vulnz api-keys create --user=<id> --name="Key Name"
vulnz api-keys revoke <key>

vulnz reports send --user=<id>
vulnz reports schedule

vulnz db migrate
vulnz db seed
vulnz db backup --type=all
```

#### Dependencies

- Complete and review all dev-notes documentation
- Plan CLI architecture (Commander.js or similar)
- Ensure API endpoints support all required operations
- Create comprehensive tests for CLI commands

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
