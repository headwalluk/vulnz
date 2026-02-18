# Installation Guide

Complete installation instructions for VULNZ.

---

## Requirements

- **Node.js**: v22.0.0 or higher
- **MySQL** or **MariaDB**: Any recent version
- **npm**: Comes with Node.js
- **BASH**: For utility scripts (backup, session secret generation)

---

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/headwalluk/vulnz
cd vulnz
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required Node.js packages and copy vendor dependencies to `public/vendor/`.

### 3. Create Database

Create a MySQL/MariaDB database for VULNZ:

```sql
CREATE DATABASE vulnz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vulnz'@'localhost' IDENTIFIED BY 'your-secure-password';
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Configure Environment

Copy the sample environment file:

```bash
cp env.sample .env
```

Edit `.env` and configure at minimum:

```plaintext
# Database connection
DB_HOST=localhost
DB_PORT=3306
DB_USER=vulnz
DB_PASSWORD=your-secure-password
DB_NAME=vulnz

# Server configuration
HTTP_LISTEN_PORT=3000
BASE_URL=http://localhost:3000
```

### 5. Generate Session Secret

Generate a cryptographically secure session secret:

```bash
bash scripts/generate-session-secret.sh
```

This will automatically add `SESSION_SECRET` to your `.env` file.

### 6. Start the Application

For development:

```bash
npm run dev
```

For production (see [Deployment Guide](deployment.md)):

```bash
npm run build
npm start
```

### 7. Create Administrator Account

The first admin account **must be created via the CLI** — there is no web-based setup mode. This ensures only someone with shell access to the server can bootstrap the application.

```bash
node bin/vulnz.js user:add --admin
```

You will be prompted for a username, email address, and password. The `--admin` flag grants full administrator privileges.

> **Why CLI-only?** A web-based setup mode (e.g. `SETUP_MODE=true`) creates a window where any visitor could initialize the database and create themselves an admin account. The CLI approach eliminates that risk entirely — if you can run this command, you already have shell access.

---

## Directory Structure

```
vulnz/
├── src/                    # Application source code
│   ├── models/            # Database models
│   ├── routes/            # API routes
│   ├── middleware/        # Express middleware
│   ├── lib/               # Utilities
│   ├── config/            # Configuration
│   ├── migrations/        # Database migrations
│   └── emails/            # Email templates
├── public/                # Static files (development)
│   ├── css/
│   ├── js/
│   └── images/
├── dist/                  # Built assets (production)
├── tests/                 # Test files
├── scripts/               # Utility scripts
├── .env                   # Environment configuration (create this)
├── package.json           # Dependencies
└── README.md             # Project overview
```

---

## Post-Installation

### Disable Public Registration (Recommended)

Once your admin account is created, consider disabling public registration:

```plaintext
# In .env file
REGISTRATION_ENABLED=false
```

Restart the application for changes to take effect. Additional users can always be created via the CLI:

```bash
node bin/vulnz.js user:add
```

### Configure Email (Optional)

To enable weekly vulnerability reports, configure SMTP:

```plaintext
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=vulnz@example.com
```

### Test Email

After configuring SMTP, test email sending from the Dashboard → Weekly Reports → "Send test email now" button.

### Configure WordPress.org Sync (Optional)

VULNZ can automatically fetch metadata from wordpress.org:

```plaintext
# Update method: api, disabled
# api: Fetch from wordpress.org API
# disabled: Don't sync (faster startup)
REFERENCE_UPDATE_METHOD=api
```

### Set Up Backups

Configure automated database backups:

```bash
# Backup all tables
./scripts/backup.sh --all

# Or use mysqldump directly
mysqldump -u vulnz -p vulnz > backup.sql
```

See [Backup & Restore](backup-restore.md) for more details.

---

## Verification

### Check Database Tables

After starting the application, verify tables were created:

```bash
mysql -u vulnz -p vulnz -e "SHOW TABLES;"
```

Expected tables:

- `users`, `roles`, `user_roles`
- `websites`, `website_components`
- `components`, `component_types`, `releases`, `vulnerabilities`
- `security_events`, `security_event_types`
- `api_keys`, `sessions`
- `migrations`

### Check Migrations

Verify all migrations ran successfully:

```bash
mysql -u vulnz -p vulnz -e "SELECT * FROM migrations ORDER BY created_at;"
```

### Access the UI

Navigate to `http://localhost:3000` and verify:

- Search page loads
- Can register/login
- Dashboard is accessible
- API documentation at `/doc` is available

### Test API

```bash
# Get OpenAPI spec
curl http://localhost:3000/openapi.json

# Search for components (no auth required)
curl "http://localhost:3000/api/components/search?query=woocommerce"
```

---

## Troubleshooting

### Database Connection Fails

**Error**: `ER_ACCESS_DENIED_ERROR: Access denied for user`

**Solution**:

- Verify database credentials in `.env`
- Ensure MySQL user has correct permissions
- Check MySQL is running: `sudo systemctl status mysql`

### Port Already in Use

**Error**: `Error: listen EADDRINUSE: address already in use :::3000`

**Solution**:

- Change `HTTP_LISTEN_PORT` in `.env`
- Or stop the process using port 3000

### Session Secret Warning

**Error**: `Warning: SESSION_SECRET not set`

**Solution**:

```bash
bash scripts/generate-session-secret.sh
```

### Cannot Register Users

**Issue**: Registration disabled

**Solution**:

- Set `REGISTRATION_ENABLED=true` in `.env` if you want public registration
- Or create users directly via the CLI: `node bin/vulnz.js user:add`

### Migrations Not Running

**Issue**: Tables not created on startup

**Solution**:

- Check logs for migration errors
- Verify database user has CREATE TABLE privileges
- Manually run migrations (not recommended):
  ```javascript
  const migrations = require('./src/migrations');
  migrations.run();
  ```

---

## Next Steps

- [Configure](configuration.md) additional settings
- Set up [Production Deployment](deployment.md)
- Configure [Reverse Proxy](reverse-proxy.md)
- Enable [Weekly Reports](weekly-reports.md)
- Explore the [API](api-usage.md)
