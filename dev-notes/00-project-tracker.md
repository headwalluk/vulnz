# VULNZ Project Tracker

Active development tracking for VULNZ features and releases.

---

## Current Version: 1.21.2

**Status**: Production  
**Last Updated**: January 2, 2026

### Recent Changes

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

## Next Steps

- [ ] Complete documentation reorganization (dev-notes/ and docs/)
- [ ] Review and improve test coverage
- [ ] Plan CLI tool architecture
- [ ] Audit security patterns across codebase
- [ ] Plan React SPA for future admin interface
