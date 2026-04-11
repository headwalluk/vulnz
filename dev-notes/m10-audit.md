# M10.1 — UI Decommission Audit

**Branch:** `m10-ui-decommission`
**Created:** 2026-04-11
**Purpose:** Complete inventory of everything to delete, simplify, or replace during M10. This is a working document and will be removed as the final step of M10 (task M10.17).

**Baseline test state:** 246 passing, 1 pre-existing failure (`tests/api/auth.test.js` — `validate-token` test, disappears as a side effect of M10), 10 skipped.

---

## 1. Source files — delete entirely

| File | Reason |
|---|---|
| `src/models/session.js` | Session table model — no sessions after M10 |
| `src/models/passwordResetToken.js` | Password reset token model — reset flow removed |
| `src/routes/auth.js` | Every route in here is session-based or reset-based: `register`, `login`, `logout`, `me` (UI sitemap), `reset-password`, `update-password`, `validate-token/:token`. None have an API-key equivalent worth preserving in v1. User management is via CLI |
| `src/config/passport.js` | **Rewrite**, not delete — remove `LocalStrategy`, `serializeUser`, `deserializeUser`; keep `HeaderAPIKeyStrategy` |
| `src/middleware/redirectHtml.js` | 301-redirects `.html` URLs — UI-only concern |
| `src/middleware/versionAssets.js` | Cache-busts `?ver=X` on HTML file references — UI-only |
| `src/middleware/cacheControl.js` | Serves Cache-Control headers for CSS/JS/fonts — UI-only. Any cache headers the new landing page needs can be inlined |
| `src/emails/password-reset.hbs` | Password reset email template |

## 2. Source files — simplify

### `src/middleware/auth.js`

Currently exports 9 functions. After M10:

| Function | Action |
|---|---|
| `apiOrSessionAuth` → `apiAuth` | Rename; strip the `isAuthenticated` fallback. Passport headerapikey path only. Set `req.user` directly instead of `req.logIn` |
| `optionalApiOrSessionAuth` → `optionalApiAuth` | Same treatment |
| `apiKeyOrSessionAdminAuth` → `apiKeyAdminAuth` | Same treatment; strip session fallback |
| `hasRole` | Rewrite to check `req.user` directly (set by `apiAuth`) instead of `req.isAuthenticated()` |
| `isAuthenticated` | **Delete** — was only the session fallback |
| `isAuthenticatedPage` | **Delete** — UI redirect helper |
| `hasRolePage` | **Delete** — UI redirect helper |
| `isAdminPage` | **Delete** — UI redirect helper |
| `redirectIfAuthenticated` | **Delete** — UI redirect helper |

### `src/index.js`

Lines to remove or modify:

- **Lines 43, 46** — imports of `session` and `passwordResetToken` models
- **Lines 49–51** — imports of `passport`, `express-session`, `express-mysql-session` → keep `passport` (still needed for HeaderAPIKeyStrategy via `src/config/passport.js`), delete the other two
- **Line 68** — import of `redirectIfAuthenticated`, `isAuthenticatedPage`, `isAdminPage` (all deleted)
- **Lines 69–71** — imports of `versionAssets`, `setCacheControl`, `redirectHtml` (all deleted)
- **Line 125** — `app.use(redirectHtml)`
- **Lines 187–195** — `MySQLStore` session store setup
- **Lines 197–207** — `expressSession(...)` middleware mounting
- **Line 210** — `app.use(passport.session())` (keep line 209: `passport.initialize()` — still needed for the API-key strategy)
- **Lines 224–238** — production build-artifact check (reads from `../dist`) — delete; new landing page is self-contained
- **Lines 240–274** — all UI routes (`/login`, `/register`, `/reset-password`, `/dashboard`, `/admin`, `/admin/users`, `/admin/components`, `/admin/api-logs`, `/`) → replace `/` with new landing page handler, delete the rest
- **Line 279** — `app.use('/api/auth', authRoutes)` (delete — whole file is going)
- **Lines 293–294** — `setCacheControl` + `express.static(...)` — replace with a minimal `express.static('public')` call that serves just the new landing page's assets (favicon SVG/PNG)
- **Lines 297–300** — 404 handler reading `404.html` — replace with a plain JSON 404 response
- **Lines 308, 315** — startup `session.createTable()` and `passwordResetToken.createTable()` calls
- **Lines 344–347** — the daily cron `sessionStore.clearExpiredSessions()`

### `src/lib/env.js`

- **Line 45** — remove `REGISTRATION_ENABLED` from `boolVars` list (only used by the deleted `/api/auth/register` route)

### `src/models/user.js`

- Remove `updatePassword(userId, newPassword)` function if it's only used by the reset flow. Needs verification — the CLI `user:reset-password` command may use it too, in which case keep it
- Remove any session-related or reset-token-related helpers

## 3. Migrations to add

New forward-only migrations to drop legacy tables:

- `YYYYMMDDHHMMSS-drop-sessions-table.js` — `DROP TABLE IF EXISTS sessions`
- `YYYYMMDDHHMMSS-drop-password-reset-tokens.js` — `DROP TABLE IF EXISTS password_reset_tokens`

## 4. Directories and files to delete wholesale

| Path | Notes |
|---|---|
| `public/admin/` | `api-logs.html`, `components.html`, `users.html` |
| `public/css/` | `app.css` — UI stylesheet |
| `public/js/` | `admin/`, `api-logs.js`, `app.js`, `auth.js`, `dashboard.js`, `index.js`, `login.js`, `register.js`, `register-page.js`, `reset-password.js`, `reset-password-page.js` |
| `public/partials/` | `footer.html`, `header.html` — UI partials |
| `public/vendor/` | `bootstrap/`, `jquery/`, `select2/` — frontend libraries |
| `public/images/` | UI images (contents not yet inspected, but scoped for deletion) |
| `public/404.html` | UI 404 page |
| `public/dashboard.html` | Logged-in dashboard |
| `public/index.html` | The old search-box landing page |
| `public/login.html` | Login form |
| `public/register.html` | Registration form |
| `public/reset-password.html` | Password reset form |
| `dist/` | Entire production build output (404.html, admin/, build/, dashboard.html, images/, index.html, login.html, partials/, register.html, reset-password.html) |

**`public/` survivors after deletion:** just `icon.svg` (and the new `icon.png` fallback generated during M10.9).

## 5. Scripts to delete

| Path | Notes |
|---|---|
| `scripts/build.js` | Builds UI assets — no UI, no build |
| `scripts/copy-vendor-deps.js` | Copies bootstrap/jquery/select2 into `public/vendor/` — no vendor |
| `scripts/generate-session-secret.sh` | No sessions |

## 6. `package.json` changes

### Remove from `scripts`:

- `"clean": "rm -rf dist"` — no `dist`
- `"build": "node scripts/build.js"` — no build
- `"postinstall": "node scripts/copy-vendor-deps.js"` — no vendor copy

### Remove from `dependencies`:

- `express-mysql-session` — session store
- `express-session` — session middleware
- `passport-local` — LocalStrategy
- `select2` — UI lib
- `select2-bootstrap-5-theme` — UI lib

### **Keep** from `dependencies`:

- `passport` — **required** for HeaderAPIKeyStrategy (flagged in M10.8, confirmed by audit)
- `passport-headerapikey` — API key auth
- `handlebars` — still used by `src/emails/vulnerability-report.hbs` cron job
- `bcrypt` — CLI user creation + password hashing

### Remove from `devDependencies`:

- `cssnano` — CSS minification (build-only)
- `fast-glob` — used by build/copy scripts — verify no other references before removing
- `html-minifier-terser` — HTML minification (build-only)
- `html-validate` — HTML validation (build-only)
- `postcss` — PostCSS (build-only)
- `postcss-url` — PostCSS plugin (build-only)
- `terser` — JS minification (build-only)

### **Keep** from `devDependencies`:

- `sqlite3` — still used by the SQLite test shim until M11 (not part of M10 scope)
- Jest, ESLint, Prettier, nodemon, supertest, etc.

## 7. Environment variables to remove

- `SESSION_SECRET` — used only by `expressSession()` in `src/index.js:199`
- `SESSION_DURATION_DAYS` — used only by session store + cookie config in `src/index.js:194,204`
- `PASSWORD_RESET_TOKEN_DURATION` — used only by `routes/auth.js:365` (validate-token)
- `REGISTRATION_ENABLED` — used only by `routes/auth.js:55` (register endpoint) and `src/lib/env.js:45`
- `SERVER_MODE` — verify usage; the `setup` value is referenced in `routes/auth.js:71` to auto-promote registered users to admin. If no other code reads `SERVER_MODE`, remove it from `.env.example` and any env helper references (it may be a leftover from the CLI migration in M1)
- **Possibly** `PASSWORD_MIN_*` vars (6 of them per the M7 description) — need to verify whether `src/lib/passwordValidation.js` is still used by CLI password commands. If only used by the reset flow and registration form, remove; if also used by CLI, keep

All of these need to come out of `.env.example` too.

## 8. Tests to update

**Every test file in `tests/api/`** currently stands up its own Express app in `beforeAll`, and every file references `express-session`, `passport.initialize()`, and `passport.session()` in that setup (confirmed for `components.test.js`; other 10 files need the same treatment). This is repetitive boilerplate that will need stripping from all of them.

| File | Action |
|---|---|
| `tests/api/auth.test.js` | **Delete entirely** — tests login, register, reset-password, validate-token, all of which are being removed |
| `tests/api/components.test.js` | Strip session/passport boilerplate from `beforeAll` setup; keep all component-route tests |
| `tests/api/component-types.test.js` | Same — strip session boilerplate |
| `tests/api/ecosystems.test.js` | Same |
| `tests/api/notifications.test.js` | Same |
| `tests/api/releases.test.js` | Same |
| `tests/api/settings.test.js` | Same |
| `tests/api/users.test.js` | Same — and update tests that assumed session-based admin access to use API-key-based admin instead |
| `tests/api/vulnerabilities.test.js` | Same |
| `tests/api/websites.test.js` | Same |
| `tests/api/websites-npm.test.js` | Same |
| `tests/cli/vulnz.test.js` | Unlikely to need changes — CLI never used sessions. Verify though |
| `tests/setup.js` | Verify it doesn't reference session/reset-token tables in any schema setup |
| `tests/jest.setup.js` | Verify it doesn't set `SESSION_SECRET` or similar test-only env vars |

**Audit note on test boilerplate:** the fact that every API test file mirrors the production Express setup (sessions + Passport) is a code smell that M10 will expose. After M10, we can introduce a shared `createTestApp()` helper in `tests/setup.js` that returns a minimal Express app with just `passport.initialize()` + API key strategy + routes. That cleanup is in scope for M10.12 tests updates, not a separate task — just note that the "fix" is centralising, not duplicating the strip across 10 files.

## 9. Documentation updates

| File | Change |
|---|---|
| `CLAUDE.md` | Remove "session-based (web UI)" from the auth description. Note admin UI is now vulnz-woo WP plugin. Remove web UI references from architecture overview. Drop `npm run build` from commands list |
| `AGENTS.md` | Same treatment — remove web UI references, update non-negotiable rules if any mention sessions |
| `README.md` | Full rewrite of the "Getting Started" / "Authentication" sections to reflect CLI + API only |
| `dev-notes/03-architecture-overview.md` | Update request flow diagram (remove session middleware leg), update auth section |
| `dev-notes/05-security-patterns.md` | Remove session security notes; keep API key security |
| `dev-notes/06-testing-guide.md` | Note that session boilerplate has been removed from test setup (pre-M11) |

## 10. New code to add (M10.9 / M10.10 / M10.11)

### `src/routes/landing.js` (new file, or inline in `src/index.js`)

A single `GET /` handler that:

1. Reads `version` and `description` from `package.json`
2. Calls a lightweight `getSystemHealth()` helper — returns `{ operational: true }` unless the DB is unreachable
3. Content-negotiates:
   - If `req.accepts('html')` (default for browsers): returns the inlined HTML page
   - If `req.accepts('json')` from the request's `Accept` header: returns a JSON object `{ name, version, tagline, status, links: { health, github, swaggerUi, openapi } }`

### `public/icon.svg` — already in place

### `public/icon.png` — to generate via `convert public/icon.svg -resize 512x512 public/icon.png`

### New landing page HTML (inlined in the route handler)

Composition:

- **Background**: `#0f172b`
- **Card**: centered, `#1e293b` or similar (lighter slate), rounded corners, subtle border
- **Inlined**: `artwork/vulnz-dark-mode.svg` as the header logo (~200px wide)
- **Title**: "VULNZ API" in Inter bold (loaded from Google Fonts)
- **Version**: small muted text from `package.json`
- **Tagline**: "Self-hosted vulnerability database for WordPress plugins, themes, and npm packages"
- **Status pill**: green `#10b982` "System Operational"
- **2×2 button grid**:
  - Health Check → `/api/ping` (existing endpoint — serves as health check since it's cheap and always responsive)
  - GitHub Repo → `https://github.com/headwalluk/vulnz` (from `package.json.repository.url`)
  - API Documentation → `/doc` (Swagger UI — **note path is `/doc`, not `/api-docs`**)
  - OpenAPI Spec → `/openapi.json`
- **Footer**: `© 2026 Vulnz. All rights reserved.`

**Dependencies**: no external JS; Inter loaded from Google Fonts via `<link>`; all CSS inline; no framework.

## 11. Key findings / corrections to M10 plan

1. **`public/` *is* the legacy web UI** — there's no separate `views/` or template engine directory. Everything lives in `public/` and is served via `express.static()`. This means M10.2 is a simple `rm -rf` of the subdirectories and legacy HTML files, not a hunt across multiple directories.

2. **There's also a `dist/` directory** with production build artifacts from `npm run build`. This must be deleted along with `public/` content. The `"build"`, `"clean"`, and `"postinstall"` npm scripts all go.

3. **Swagger UI path is `/doc`, not `/api-docs`.** M10.11 needs to reference the correct path. Both `/doc` and `/openapi.json` are retained.

4. **Every API test file imports `express-session` and `passport.session()`** even though they test API-key routes. This is mirroring the production server setup. All 11 test files need the session boilerplate stripped from their `beforeAll` — worth centralising into a `createTestApp()` helper rather than duplicating the strip.

5. **The pre-existing failing test** (`auth.test.js` validate-token) lives in a file that gets deleted entirely in M10. No fix needed — it disappears.

6. **`src/config/passport.js` contains both strategies** — LocalStrategy (delete) and HeaderAPIKeyStrategy (keep). The file needs editing, not deletion. The `serializeUser`/`deserializeUser` functions are session-only and go.

7. **`passport` itself must stay** — HeaderAPIKeyStrategy plugs into Passport. M10.8 was correct to flag this concern; the audit confirms.

8. **`REGISTRATION_ENABLED` env var** is normalised in `src/lib/env.js` and only used by the deleted register route. Removal from env.js is in scope.

9. **`SERVER_MODE`** is referenced in `routes/auth.js:71` for auto-admin promotion during registration. This appears to be a leftover from the `SETUP_MODE` migration in M1. Since routes/auth.js is deleted, this reference disappears; verify no other file reads `SERVER_MODE` before removing it from `env.js` and `.env.example`.

## 12. Execution order (revised task sequence)

Based on the audit, the safest order to execute M10 tasks:

1. **M10.1** ✅ — this audit
2. **M10.4** + **M10.5** — delete session and password-reset models; add drop-table migrations. Do *not* run the migrations yet on dev — we need the code change first so the models aren't trying to create tables that are being dropped
3. **M10.3** — strip session middleware from `src/index.js`, delete `routes/auth.js`, update `src/config/passport.js` to remove LocalStrategy. Run tests — expect many failures in the API test files that reference session setup
4. **M10.12** — centralise test setup into `createTestApp()` helper, strip session boilerplate from all API test files, delete `tests/api/auth.test.js`. Run tests — back to green
5. **M10.6** — rename middleware functions (`apiOrSessionAuth` → `apiAuth` etc.), update all route imports. Run tests — back to green
6. **M10.2** — delete the UI files in `public/` and `dist/`, delete `src/middleware/{redirectHtml,versionAssets,cacheControl}.js`, delete `src/emails/password-reset.hbs`, delete UI-related scripts in `scripts/`
7. **M10.7** — remove env vars from `src/lib/env.js` and `.env.example`
8. **M10.8** — update `package.json`: remove deps, scripts, run `npm install` to regenerate lockfile
9. **M10.9** + **M10.10** + **M10.11** — generate `icon.png`, build the new landing page with content negotiation, verify Swagger UI survives
10. **M10.13** — tests for the landing page
11. **M10.14** + **M10.15** — documentation updates
12. **M10.16** — version bump, CHANGELOG
13. **M10.17** — deploy to dev, smoke-test, deploy to prod. **Delete this audit file (`dev-notes/m10-audit.md`) as part of the final commit.**
