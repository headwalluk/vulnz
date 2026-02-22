# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VULNZ is a self-hosted vulnerability database API for WordPress plugins/themes and npm packages. Built with Node.js v22+, Express 5, and MariaDB. Pure CommonJS — no TypeScript, no ESM.

## Commands

```bash
npm run dev            # Start dev server with nodemon
npm test               # Run all Jest tests (184 tests, in-memory SQLite)
npm test -- auth       # Run a single test file by name match
npm run test:watch     # Jest watch mode
npm run test:coverage  # Coverage report (50% threshold)
npm run lint           # ESLint check
npm run format         # Prettier auto-format
npm start              # Production start (NODE_ENV=production)
npm run build          # Build production assets
```

## Non-Negotiable Rules

- **CommonJS only** — `require()` / `module.exports`. No ESM `import/export`.
- **No ORM** — raw SQL via `src/db.js`'s `query()` function with parameterized queries.
- **No direct `process.env` access** — all env vars are normalised at startup via `src/lib/env.js`. Use `parseBool()`, `parseIntEnv()`, or `parseEnum()` from that module.
- **BigInt `insertId`** — always convert with `parseInt(result.insertId, 10)`.
- **Passwords via bcrypt** — `bcrypt.hash()` with rounds=10. Never plaintext.
- **Validate before writing** — use `validateEmailAddress()` and `validatePassword()` from `src/lib/`.
- **Sanitize HTML** — use `sanitize-html` for user-supplied HTML, `sanitizer.stripAll()` for plain text fields.
- **No magic strings** — use named constants for roles, statuses, etc.

## Architecture

**Request flow:** Rate Limiting → Authentication (Passport) → Role Check → API Call Logging → Route Handler → Model → Response

**Dual authentication:**
- Session-based (web UI) via Passport LocalStrategy, sessions stored in MySQL
- API key-based (CLI/plugins) via `X-API-Key` header with HeaderAPIKeyStrategy
- Most routes use `apiOrSessionAuth` middleware which accepts either

**Models** (`src/models/`) are functional modules (not classes) exporting CRUD functions: `createTable()`, `findAll()`, `findById()`, `create()`, `update()`, `remove()`. All use `db.query(sql, params)` — never create direct DB connections.

**Migrations** (`src/migrations/`) run automatically on startup, tracked in a `migrations` table. Forward-only, named with timestamps (YYYYMMDDHHMMSS). No rollback support.

**CLI tool** (`bin/vulnz.js`) imports models directly — does NOT start the Express server. Uses `commander` for arg parsing. Loads `dotenv` before requiring any `src/` modules.

**Multi-ecosystem:** Components have an `ecosystem_id` foreign key. Currently supports WordPress (plugins + themes) and npm. Extensible for PyPI, Composer, etc.

## Testing

Tests use an **in-memory SQLite** database (`tests/setup.js`) with automatic MySQL→SQLite SQL conversion. Key test utilities:
- `createTestDatabase()` — sets up in-memory SQLite
- `initializeSchema(db)` — creates all tables
- `createTestUser(db, options)` — creates user with roles
- `createTestApiKey(db, userId)` — generates test API key
- `cleanupTestDatabase(db)` — closes connections

Tests mock `src/db` and redirect queries to SQLite. Test files live in `tests/api/` and `tests/cli/`.

## Adding Features

**New API endpoint:** Create model in `src/models/`, create route in `src/routes/` with Swagger JSDoc comments, register route in `src/index.js` with `app.use()`, add tests in `tests/api/`.

**New table:** Create migration in `src/migrations/YYYYMMDDHHMMSS-description.js` exporting `{ up }`, create model with `createTable()`, call `createTable()` in `src/index.js` startup.

**New env var:** Add to `env.sample`, parse in `src/lib/env.js` using the helper functions, never use raw `process.env` elsewhere.

## Key Documentation

Detailed guides live in `dev-notes/`:
- `01-coding-style.md` — JS conventions and patterns
- `02-database-schema.md` — full schema reference
- `03-architecture-overview.md` — system diagram and request flows
- `04-common-patterns.md` — patterns for adding models, routes, migrations
- `05-security-patterns.md` — security conventions (read before touching auth)
- `06-testing-guide.md` — Jest/Supertest patterns

Also see `AGENTS.md` for the full list of non-negotiable rules and project conventions.

## Commit Format

```
[M#] type: brief description
```

Types: `feat:` `fix:` `chore:` `refactor:` `docs:` `test:`
