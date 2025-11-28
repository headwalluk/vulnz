# VULNZ

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Database](https://img.shields.io/badge/database-MySQL%2FMariaDB-blue)](https://mariadb.org/)
[![Security](https://img.shields.io/badge/security-bcrypt%20%7C%20helmet-success)](docs/roadmap.md)

Self-hosted vulnerability database for WordPress plugins and themes. The database is primarily accessed through an API, and there is a UI for basic admin tasks.

The application pulls from wordpress.org for plugin & theme metadata. We don't store details about each vulnerability - only link(s) to the original disclosure URL(s).

This can best be thought of as a vulnerability metabase.

![VULNZ search results](assets/v1.0.0/vulnz-search-results.png 'VULNZ search results')

## Who is this for?

The app is designed to help WordPress hosting providers collate and manage WP plugin vulnerabilities across their clients' sites. If you want your VULNZ installation to be publicly accessible, you can host it behind a reverse-proxy and manage your SSL in Apache/Nginx.

![List of websites](assets/v1.3.0/vulnz-dashboard-your-websites.png 'Websites managed in VULNZ')

![Reporting and API Keys](assets/v1.3.0/vulnz-reporting-and-api-keys.png 'Reporting and API Key management')

## Documentation

- **[Development Setup](docs/development.md)** - Get VULNZ running on your local development machine
- **[Production Deployment](docs/deployment.md)** - Deploy VULNZ to a production server
- **[Reverse Proxy Setup](docs/reverse-proxy.md)** - Configure Apache or Nginx with SSL/TLS
- **[Wordfence Feed Importer](docs/wordfence-importer.md)** - Automatically import vulnerabilities from Wordfence
- **[API Usage](docs/api-usage.md)** - REST API examples and documentation
- **[WordPress Plugin](docs/wordpress-plugin.md)** - WordPress plugin to sync sites with VULNZ
- **[Roadmap](docs/roadmap.md)** - Planned features and security enhancements

## Quick Start

```bash
# Clone and install
git clone https://github.com/headwalluk/vulnz
cd vulnz
npm install

# Configure
cp env.sample .env
# Edit .env with your database credentials

# Run in development
npm run dev
```

Visit `http://localhost:3000` and register your first user (will be granted admin privileges in setup mode).

For detailed instructions, see the [Development Setup](docs/development.md) guide.

## Requirements

- Node: v22+ recommended
- MySQL/MariaDB

## License

[MIT](./LICENSE)
