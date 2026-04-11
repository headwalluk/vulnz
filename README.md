# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/README.md)
[![Tests](https://img.shields.io/badge/tests-235%20passing-brightgreen)](tests/README.md)

Self-hosted vulnerability database for WordPress plugins, themes, and npm packages. Track vulnerabilities, monitor security events, and manage web applications across your infrastructure.

> ⚠️ **Breaking change in v1.31.0 — no built-in web UI.** From v1.31.0 onwards, vulnz-api ships as a headless CLI + API service only. The legacy admin web UI, session-based login, and email-based password reset have all been removed. Administration is handled entirely through the `vulnz` CLI tool. If you were using the web UI in v1.30.x or earlier, see the [CHANGELOG](CHANGELOG.md) for full details and migration notes.

## About

VULNZ is a security monitoring platform designed for web agencies and hosting providers managing multiple applications. It helps you:

- **Track vulnerabilities** in WordPress plugins, themes, and npm packages
- **Monitor security events** like failed logins and attack attempts
- **Track software versions** (WordPress core, PHP, Node.js, database)
- **Audit component changes** (plugin/theme/package installations and updates)
- **Manage user accounts** with pause/unpause and block/unblock controls
- **Generate weekly reports** with actionable security recommendations
- **Sync subscriptions** from WordPress/WooCommerce sites via notification integration

The application stores links to vulnerability disclosures from sources like Wordfence and OSV.dev, acting as a vulnerability metabase rather than duplicating full vulnerability details.

VULNZ supports multiple component ecosystems — WordPress and npm are available out of the box, with an extensible architecture for adding others (PyPI, Composer, etc.).

## Quick Start

```bash
git clone https://github.com/headwalluk/vulnz
cd vulnz
npm install
cp .env.example .env
# Edit .env with your database credentials
npm run dev
```

Visit `http://localhost:3000/` to see the status landing page, or `http://localhost:3000/doc` for the Swagger UI. Create your first administrator account from the CLI:

```bash
node bin/vulnz.js user:add admin@example.com 'your-password' --admin
node bin/vulnz.js key:generate admin@example.com
```

Then use the generated API key with `X-API-Key: <key>` to authenticate against the API.

## Requirements

- **Node.js**: v22.0.0 or higher
- **Database**: MySQL 8.0+ or MariaDB 10.6+
- **Optional**: MaxMind GeoLite2 database for GeoIP features

## Documentation

- [Overview](docs/README.md) - Feature overview and architecture
- [Installation](docs/installation.md) - Development and production setup
- [Configuration](docs/configuration.md) - Environment variables reference
- [Database Setup](docs/database-setup.md) - Schema, migrations, and backups
- [API Documentation](docs/api-usage.md) - REST API reference and examples
- [CLI Reference](docs/cli.md) - Administration commands
- [Testing Guide](tests/README.md) - Running and writing tests

## License

[MIT](./LICENSE)
