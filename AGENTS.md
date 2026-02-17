# AGENTS.md — vulnz-api

**Project:** Vulnz API  
**Lead:** Zee  
**Stack:** Node.js (CommonJS), Express 5, MariaDB (raw SQL via `mariadb` package)  
**Primary repo:** https://github.com/headwalluk/vulnz

This file is for AI coding agents working on this project. Read it before making any changes.

---

## Start Here

| Document                                                                                                         | Purpose                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`~/Documents/project-notes/node-mariadb-express-api.md`](~/Documents/project-notes/node-mariadb-express-api.md) | **Stack-level guide** — env vars, DB access, CLI tools, testing conventions for this project type |
| [`dev-notes/01-coding-style.md`](dev-notes/01-coding-style.md)                                                   | JS conventions, patterns, and anti-patterns                                                       |
| [`dev-notes/02-database-schema.md`](dev-notes/02-database-schema.md)                                             | Database structure reference                                                                      |
| [`dev-notes/03-architecture-overview.md`](dev-notes/03-architecture-overview.md)                                 | How the app fits together                                                                         |
| [`dev-notes/04-common-patterns.md`](dev-notes/04-common-patterns.md)                                             | Reusable patterns used across the codebase                                                        |
| [`dev-notes/05-security-patterns.md`](dev-notes/05-security-patterns.md)                                         | Security conventions — read before touching auth                                                  |
| [`dev-notes/00-project-tracker.json`](dev-notes/00-project-tracker.json)                                         | **Zee's project tracker** — current milestone and tasks                                           |
| [`dev-notes/00-project-tracker-paul-archive.md`](dev-notes/00-project-tracker-paul-archive.md)                   | Paul's original tracker — reference only                                                          |

---

## Non-Negotiable Rules

- **CommonJS only** — `require()` / `module.exports`. No ESM `import/export`.
- **No ORM** — raw SQL via `src/db.js`'s `query()` function. Keep it clean.
- **No magic strings** — use named constants for roles, statuses, etc.
- **Passwords via bcrypt** — always use `bcrypt.hash()` with rounds=10. Never store plaintext.
- **Validate before writing** — use `validateEmailAddress()` and `validatePassword()` from `src/lib/` before any user creation or update.
- **Sanitize HTML** — use `sanitize-html` for any user-supplied HTML content.
- **No `console.log` in production paths** — use the existing logging patterns; check `LOG_LEVEL` env var.
- **No direct `process.env` access** — all environment variables are normalised at startup via `src/lib/env.js`. Use `parseBool()`, `parseIntEnv()`, or `parseEnum()` from that module. Never scatter raw `process.env.MY_VAR` calls across routes, models, or middleware.
- **BigInt `insertId`** — always convert with `parseInt(result.insertId, 10)` before storing or returning.

---

## Project Structure

```
vulnz-api/
├── src/
│   ├── index.js          # Express app entry point
│   ├── db.js             # MariaDB connection pool — import this for all queries
│   ├── config/           # db.js, passport.js, etc.
│   ├── models/           # Plain SQL functions (user, apiKey, component, etc.)
│   ├── routes/           # Express route handlers
│   ├── lib/              # Utilities (email validation, password validation, etc.)
│   └── views/            # Handlebars templates
├── bin/
│   └── vulnz.js          # CLI tool (in progress — M1)
├── scripts/              # Shell scripts (Wordfence feed ingestion, etc.)
├── tests/                # Jest test suite
├── dev-notes/            # All project documentation
├── env.sample            # Template for .env — NEVER copy over existing .env
└── package.json
```

---

## CLI Tool (Current Focus — M1)

The CLI lives at `bin/vulnz.js`. It must:

- Load `dotenv` at the top before requiring any src/ modules
- Import models directly from `src/models/` — do NOT start the Express server
- Use `commander` for argument parsing
- Output a plain text table by default; support `--json` flag for scripted use
- Exit with code `1` on error, `0` on success
- Print clear, human-readable error messages (not raw stack traces)

**Commands being built (M1):**

- `user:add <email> <password> [--admin]`
- `user:list`
- `user:delete <email>`
- `user:block <email>` / `user:unblock <email>`
- `user:reset-password <email> <new-password>`

---

## Development Workflow

```bash
npm run dev    # Start with nodemon (development)
npm test       # Run Jest test suite
npm run lint   # ESLint
npm run format # Prettier
```

### Pre-Commit Checklist

1. `npm run lint` — no errors
2. `npm run format` — apply formatting
3. `npm test` — all tests pass
4. Commit with descriptive message: `[M1] feat: add user:add CLI command`

### Commit Format

```
[M#] type: brief description

- Detail if needed
```

**Types:** `feat:` `fix:` `chore:` `refactor:` `docs:` `test:`

---

## Database Access

Always go through `src/db.js`:

```js
const db = require('../db');
const rows = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

Never create a new mariadb connection directly. Never use `mysql2` or any other driver.

---

## Environment

- Copy `env.sample` to `.env` — **ONLY if `.env` does not already exist**
- Always `ls -la .env` before any `cp` or `write` to avoid clobbering a working config
- `SETUP_MODE=true` in `.env` grants admin to the first registered user — this will be removed once the CLI is in place

---

## Project Tracker (JSON Format)

The tracker is `dev-notes/00-project-tracker.json`. It uses JSON booleans — **not** Markdown checkboxes.

**To mark a task complete**, set `"done": true` on the task object:

```json
{ "id": "M1.1", "description": "...", "done": true }
```

**To update milestone status**, set the milestone `"status"` field:

- `"in_progress"` — currently being worked on
- `"complete"` — all tasks done and tested
- `"planned"` — not started yet

**To update current status**, edit the top-level `"current_status"` object:

```json
{
  "summary": "M1 complete — user management CLI commands implemented and tested.",
  "next_action": "Begin M2: API key management commands"
}
```

Always update `"last_updated"` to today's date when writing the tracker.

---

## What NOT to Do

- ❌ Use ESM (`import`/`export`) — this is CommonJS
- ❌ Use an ORM (Sequelize, Prisma, etc.)
- ❌ Store passwords in plaintext
- ❌ Start the Express server from the CLI tool
- ❌ Hardcode magic strings for roles or statuses
- ❌ Copy `env.sample` over an existing `.env`
- ❌ Commit a `.env` file
- ❌ Use Markdown `[x]` checkboxes in the JSON tracker
