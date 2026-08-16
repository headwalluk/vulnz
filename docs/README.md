# VULNZ Documentation

VULNZ is a self-hosted vulnerability database for WordPress plugins, themes, and npm packages.

---

## Guides

### Setup & Installation

- [Installation Guide](installation.md) - Development and production setup
- [Configuration](configuration.md) - Environment variable reference
- [Database Setup](database-setup.md) - Schema, migrations, and backups

### Usage

- [CLI Reference](cli.md) - Administration commands (users, API keys, settings, notifications)
- [API Documentation](api-usage.md) - REST API reference and examples
- [Fast Update Triggers](fast-update-triggers.md) - Fleet latest-versions manifest, urgent-update classification, watchlist administration, and the `/api/wordpress/latest-versions` route

### Testing

- [Testing Guide](../tests/README.md) - Running and writing tests

---

## Architecture

```
┌───────────────────┐     ┌──────────────────┐
│  WP/Woo Sites     │────▶│                  │
│  (notifications)  │     │   VULNZ Server   │
├───────────────────┤     │   (Node.js)      │
│  vulnz-woo        │────▶│   API + CLI      │
│  vulnz-ingest     │     └────────┬─────────┘
│  vulnz-sensor     │              │
│  CLI tool         │              ▼
│  AI agents        │     ┌──────────────────┐
└───────────────────┘     │  MySQL/MariaDB   │
                          └──────────────────┘
```

There is no built-in web UI — it was removed in v1.31.0. Administration is the `vulnz` CLI; the customer-facing admin UI lives in the separate `vulnz-woo` WordPress plugin.

---

## Requirements

- **Node.js**: v22 or higher
- **Database**: MySQL 8.0+ or MariaDB 10.6+
- **SMTP Server**: For email reports (optional)
- **MaxMind GeoLite2**: For GeoIP features (optional)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/headwalluk/vulnz/issues)
- **License**: MIT
