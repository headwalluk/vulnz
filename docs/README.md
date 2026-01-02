# VULNZ Documentation

Welcome to the VULNZ documentation. VULNZ is a self-hosted vulnerability database for WordPress plugins and themes.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/headwalluk/vulnz
cd vulnz
npm install

# Configure
cp env.sample .env
# Edit .env with your database credentials

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the application.

---

## Documentation

### Setup & Installation

- [Installation Guide](installation.md) - Complete installation instructions
- [Configuration](configuration.md) - Environment variable reference
- [Database Setup](database-setup.md) - Database configuration and migrations

### Deployment

- [Production Deployment](deployment.md) - Deploy with PM2
- [Reverse Proxy Setup](reverse-proxy.md) - Nginx and Apache configuration
- [Backup & Restore](backup-restore.md) - Database backup strategies

### Using VULNZ

- [API Documentation](api-usage.md) - API reference and examples
- [Weekly Reports](weekly-reports.md) - Automated vulnerability reports

### Maintenance

- [Updating VULNZ](updating.md) - How to update to new versions
- [Troubleshooting](troubleshooting.md) - Common issues and solutions

---

## Features

- **Vulnerability Tracking**: Monitor WordPress plugin and theme vulnerabilities
- **Security Events**: Track failed logins, attacks, and security incidents
- **Version Monitoring**: Track WordPress core, PHP, and database versions
- **Component Auditing**: Log plugin/theme installations and updates
- **Weekly Reports**: Automated email reports with actionable recommendations
- **REST API**: Full API access for automation and integration
- **User Management**: Multi-user with role-based access control

---

## Requirements

- **Node.js**: v22 or higher
- **Database**: MySQL 5.7+ or MariaDB 10.3+
- **SMTP Server**: For email reports (optional)
- **Linux/BSD**: Recommended for production

---

## Architecture

```
┌──────────────────┐
│   Web Browser    │
│   CLI Tool       │
│   WordPress      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   VULNZ Server   │
│   (Node.js)      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  MySQL/MariaDB   │
└──────────────────┘
```

---

## Support

- **Issues**: [GitHub Issues](https://github.com/headwalluk/vulnz/issues)
- **Documentation**: You're reading it!
- **License**: MIT

---

## Next Steps

- Read the [Installation Guide](installation.md)
- Configure your [Environment](configuration.md)
- Set up [Weekly Reports](weekly-reports.md)
- Explore the [API](api-usage.md)
