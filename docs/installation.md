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

# Setup mode (enable for first run)
SETUP_MODE=true
REGISTRATION_ENABLED=true
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

1. Open your browser and navigate to `http://localhost:3000`
2. Click "Register" and create a new account
3. This first user will automatically receive administrator privileges
4. **Important**: After creating the admin account, stop the application and set `SETUP_MODE=false` in `.env`

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

### Disable Setup Mode

**Critical**: After creating your administrator account:

```plaintext
# In .env file
SETUP_MODE=false
```

Optionally disable public registration:

```plaintext
REGISTRATION_ENABLED=false
```

Restart the application for changes to take effect.

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

**Issue**: Registration disabled after setup

**Solution**:

- Check `SETUP_MODE=false` and `REGISTRATION_ENABLED=false` in `.env`
- Set `REGISTRATION_ENABLED=true` if you want public registration
- Or create users via API/CLI (future feature)

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
