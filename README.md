# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/roadmap.md)
[![Tests](https://img.shields.io/badge/tests-143%20passing-brightgreen)](tests/README.md)

Self-hosted vulnerability database for WordPress plugins and themes. Track vulnerabilities, monitor security events, and manage WordPress installations across your infrastructure.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

## About

VULNZ is a comprehensive security monitoring platform designed for WordPress hosting providers and agencies managing multiple WordPress sites. It helps you:

- **Track vulnerabilities** in WordPress plugins and themes
- **Monitor security events** like failed logins and attack attempts
- **Track software versions** (WordPress core, PHP, database)
- **Audit component changes** (plugin/theme installations and updates)
- **Manage user accounts** with pause/unpause and block/unblock controls
- **Generate weekly reports** with actionable security recommendations

The application pulls metadata from wordpress.org and stores links to vulnerability disclosures, acting as a vulnerability metabase rather than duplicating full vulnerability details.

![Websites Dashboard](assets/v1.3.0/vulnz-dashboard-your-websites.png 'Websites managed in VULNZ')

![Reporting and API Keys](assets/v1.3.0/vulnz-reporting-and-api-keys.png 'Reporting and API Key management')

## Quick Start

```bash
# Clone the repository
git clone https://github.com/headwalluk/vulnz
cd vulnz

# Install dependencies
npm install

# Configure environment
cp env.sample .env
# Edit .env with your database credentials

# Run in development mode
npm run dev
```

Visit `http://localhost:3000` to access the application. Create your first admin account using the CLI:

```bash
node bin/vulnz.js user:add admin@example.com 'your-password' --admin
```

## CLI Administration Tool

VULNZ includes a CLI tool (`bin/vulnz.js`) for managing user accounts directly from the command line — no web interface required. This is particularly useful for initial setup, scripted provisioning, and recovery scenarios.

### Running the CLI

From the project root directory (development):

```bash
node bin/vulnz.js < command > [arguments]
```

If installed globally via npm, use `vulnz` directly:

```bash
vulnz < command > [arguments]
```

The CLI reads your `.env` file automatically. Run it from the project root directory where `.env` lives.

---

### User Management Commands

#### `user:add <email> <password> [--admin]`

Create a new user account. Pass `--admin` to grant the administrator role.

```bash
# Create a standard user
node bin/vulnz.js user:add alice@example.com 'SecurePass123!'

# Create an administrator
node bin/vulnz.js user:add admin@example.com 'SecurePass123!' --admin
```

Output:

```
Created user: alice@example.com (id=3, roles=user)
Created user: admin@example.com (id=1, roles=user,administrator)
```

---

#### `user:list [--json]`

List all user accounts in a formatted table. Pass `--json` for machine-readable output.

```bash
# Formatted table
node bin/vulnz.js user:list

# JSON output (useful for scripting)
node bin/vulnz.js user:list --json
```

Output:

```
ID  USERNAME               ROLES              STATUS
------------------------------------------------------------
1   admin@example.com      user,administrator  active
2   alice@example.com      user                active
3   blocked@example.com    user                BLOCKED
```

---

#### `user:delete <email>`

Permanently delete a user account. This cannot be undone.

```bash
node bin/vulnz.js user:delete alice@example.com
```

Output:

```
Deleted user: alice@example.com (id=2)
```

---

#### `user:block <email>`

Block a user account, preventing them from logging in. Their data is preserved.

```bash
node bin/vulnz.js user:block alice@example.com
```

Output:

```
Blocked user: alice@example.com (id=2)
```

---

#### `user:unblock <email>`

Unblock a previously blocked user, restoring their access.

```bash
node bin/vulnz.js user:unblock alice@example.com
```

Output:

```
Unblocked user: alice@example.com (id=2)
```

---

#### `user:reset-password <email> <new-password>`

Reset the password for an existing user account.

```bash
node bin/vulnz.js user:reset-password alice@example.com 'NewSecurePass456!'
```

Output:

```
Password reset for user: alice@example.com (id=2)
```

---

### API Key Management Commands

API keys are used by WordPress sites and other clients to authenticate with the VULNZ REST API. Keys can be managed via the web admin interface or the CLI commands below.

#### `key:list <email> [--json]`

List all API keys associated with a user account.

```bash
# Formatted table
node bin/vulnz.js key:list alice@example.com

# JSON output (useful for scripting)
node bin/vulnz.js key:list alice@example.com --json
```

Output:

```
ID  API KEY                               CREATED
------------------------------------------------------------------
1   abc123def456abc123def456abc123def456  2026-02-01T10:00:00.000Z
2   789xyz789xyz789xyz789xyz789xyz789xyz  2026-02-10T14:30:00.000Z
```

---

#### `key:generate <email>`

Generate a new API key for a user account. The new key is printed to stdout — copy it immediately, as it cannot be retrieved later.

```bash
node bin/vulnz.js key:generate alice@example.com
```

Output:

```
Generated API key for alice@example.com: abc123def456abc123def456abc123def456
```

---

#### `key:revoke <key>`

Permanently revoke an API key. Any client using this key will immediately lose API access.

```bash
node bin/vulnz.js key:revoke abc123def456abc123def456abc123def456
```

Output:

```
Revoked API key: abc123def456abc123def456abc123def456
```

---

### Diagnostic Commands

These commands query the database directly and are useful for checking ingestion health and inspecting component data.

#### `feed:status [--json]`

Show database statistics and the last Wordfence sync timestamp.

```bash
# Formatted output
node bin/vulnz.js feed:status

# JSON output
node bin/vulnz.js feed:status --json
```

Output:

```
Feed Status
-----------
  Components:           1200
  Releases:            54321
  Vulnerabilities:       789
  Last wporg sync:  2026-01-15T10:30:00.000Z
```

Shows `never` if no sync has occurred yet.

---

#### `component:find <slug> [--json]`

Look up a component by its slug. Returns all matches — a slug may exist as both a plugin and a theme.

```bash
# Formatted table
node bin/vulnz.js component:find woocommerce

# JSON output
node bin/vulnz.js component:find woocommerce --json
```

Output:

```
ID  SLUG         TYPE    TITLE        RELEASES  VULNS
------------------------------------------------------
42  woocommerce  plugin  WooCommerce       300      5
```

Returns "No component found with slug: …" if the slug is not in the database.

---

#### `release:list <slug> [--json]`

List all known releases for a component slug, with per-release vulnerability counts.

```bash
# Formatted table
node bin/vulnz.js release:list woocommerce

# JSON output
node bin/vulnz.js release:list woocommerce --json
```

Output:

```
Component: woocommerce (WooCommerce) — plugin

VERSION  VULNS
--------------
8.5.0    2
8.4.1    -
8.4.0    1

3 release(s) listed.
```

A dash (`-`) indicates no known vulnerabilities for that release. Returns "No releases found for component: …" if the slug has no releases.

---

### Exit Codes

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Success                                        |
| `1`  | Error (user not found, validation failure, DB) |

Errors are written to stderr so they can be captured separately in scripts.

---

## Installation

### Development Setup

For local development with hot reloading and debugging:

```bash
# Install dependencies
npm install

# Configure .env (see Configuration section below)
cp env.sample .env

# Start development server
npm run dev
```

The application will be available at `http://localhost:3000`. Changes to source files trigger automatic restarts via nodemon.

**See [Development Setup Guide](docs/development.md) for detailed instructions.**

### Production Deployment

For production deployments with PM2 process management:

```bash
# Install dependencies (lockfile-only for production)
npm ci

# Build production assets
npm run build

# Configure PM2
cp ecosystem.config.js.sample ecosystem.config.js
# Edit ecosystem.config.js with your settings

# Start with PM2
pm2 start ecosystem.config.js

# Enable startup on boot
pm2 startup
pm2 save
```

**See [Production Deployment Guide](docs/deployment.md) for detailed instructions, including reverse proxy setup with SSL/TLS.**

## Configuration

### Environment Variables

Copy `env.sample` to `.env` and configure the following key settings:

#### Database Configuration (Required)

```bash
DB_HOST=localhost
DB_USER=vulnz
DB_PASSWORD=your_secure_password
DB_NAME=vulnz
DB_PORT=3306
```

#### Application Settings

```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=your_random_session_secret_here
JWT_SECRET=your_random_jwt_secret_here
```

#### Email Configuration (For Reports)

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@example.com
SMTP_PASS=your_email_password
SMTP_FROM=vulnz@example.com
```

#### Security Features

```bash
# GeoIP for security event tracking
GEOIP_DATABASE_PATH=/var/lib/GeoIP/GeoLite2-City.mmdb

# Reference data updates (version thresholds)
REFERENCE_UPDATE_METHOD=disabled # Options: url, file, disabled
REFERENCE_UPDATE_LOCATION=       # URL or file path
```

**See [env.sample](env.sample) for all available configuration options.**

### Database Setup

1. **Create database and user:**

```sql
CREATE DATABASE vulnz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vulnz'@'localhost' IDENTIFIED BY 'your_secure_password';
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'localhost';
FLUSH PRIVILEGES;
```

2. **Migrations run automatically** on application startup - no manual steps required.

3. **First user registration** automatically receives admin privileges (setup mode).

## Requirements

- **Node.js**: v22.0.0 or higher
- **Database**: MySQL 8.0+ or MariaDB 10.6+
- **Optional**: MaxMind GeoLite2 database for GeoIP features

## Upgrading

```bash
# Stop the application
pm2 stop vulnz

# Pull latest changes
git pull

# Review changes
# Compare .env with env.sample for new variables

# Install dependencies
npm ci

# Build assets
npm run build

# Restart
pm2 restart vulnz
```

**Important**: Database migrations run automatically. Always back up your database before upgrading.

## Documentation

### Getting Started

- [Development Setup](docs/development.md) - Local development environment
- [Production Deployment](docs/deployment.md) - Production deployment with PM2
- [Reverse Proxy Setup](docs/reverse-proxy.md) - Apache/Nginx with SSL/TLS

### Features & Integrations

- [API Documentation](docs/api-usage.md) - REST API reference and examples
- [Account Status Management](docs/account-status-management.md) - Pause/unpause and block/unblock users
- [WordPress Plugin](docs/wordpress-plugin.md) - Sync WordPress sites with VULNZ
- [Wordfence Importer](docs/wordfence-importer.md) - Import vulnerabilities from Wordfence
- [Security Events](docs/security-events.md) - Monitor security events with GeoIP
- [Version Tracking](docs/version-tracking.md) - Track WordPress/PHP/database versions
- [Static Analysis](docs/static-analysis.md) - PHP security scanning integration
- [Component Changes](docs/component-changes.md) - Plugin/theme change auditing
- [Enhanced Reporting](docs/enhanced-reporting.md) - Weekly security reports
- [App Settings](docs/app-settings.md) - Database-backed configuration system

### Development

- [Testing Guide](tests/README.md) - Running and writing tests
- [Project Tracker](docs/project-tracker.md) - Feature development status
- [Roadmap](docs/roadmap.md) - Planned features and improvements

## Testing

VULNZ includes comprehensive API testing:

```bash
# Run all tests
npm test

# Watch mode (re-run on changes)
npm run test:watch

# Coverage report
npm run test:coverage
```

**Current coverage**: 143 tests across Settings API, Websites API, CLI user management commands, and CLI API key management commands. See [Testing Guide](tests/README.md) for details.

## License

[MIT](./LICENSE)
