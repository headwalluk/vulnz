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

### Testing

- [Testing Guide](../tests/README.md) - Running and writing tests

---

## Architecture

```
┌──────────────────┐     ┌──────────────────┐
│   WP/Woo Sites   │��───▶│                  │
│   (notifications) │     │   VULNZ Server   │
├──────────────────┤     │   (Node.js)      │
│   Web Browser    │────▶│                  │
│   CLI Tool       │     └────────┬─────────┘
│   WordPress      │              │
│   vulnz-sensor   │              ▼
└──────────────────┘     ┌──────────────────┐
                         │  MySQL/MariaDB   │
                         └──────────────────┘
```

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
