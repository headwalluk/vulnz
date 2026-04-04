# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/README.md)
[![Tests](https://img.shields.io/badge/tests-238%20passing-brightgreen)](tests/README.md)

Self-hosted vulnerability database for WordPress plugins, themes, and npm packages. Track vulnerabilities, monitor security events, and manage web applications across your infrastructure.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

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
cp env.sample .env
# Edit .env with your database credentials
npm run dev
```

Visit `http://localhost:3000` to access the application. Create your first admin account:

```bash
node bin/vulnz.js user:add admin@example.com 'your-password' --admin
```

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
