# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/roadmap.md)
[![Tests](https://img.shields.io/badge/tests-114%20passing-brightgreen)](tests/README.md)

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

Visit `http://localhost:3000` and register your first user (automatically granted admin privileges in setup mode).

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

**Current coverage**: 33 tests across Settings API and Websites API. See [Testing Guide](tests/README.md) for details.

## License

[MIT](./LICENSE)
