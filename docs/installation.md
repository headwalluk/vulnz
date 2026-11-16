# Installation Guide

Complete installation instructions for VULNZ.

---

## Requirements

- **Node.js**: v22.12 or higher to run VULNZ; v24.9 or higher to run the test suite
- **MySQL** or **MariaDB**: Any recent version
- **npm**: Comes with Node.js
- **BASH**: For the utility scripts in `scripts/` (database backup, feed processing)

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

This installs the Node.js packages. There is no build step.

### 3. Create Database

Create a MySQL/MariaDB database for VULNZ:

```sql
CREATE DATABASE vulnz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vulnz'@'localhost' IDENTIFIED BY 'your-secure-password';
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'localhost';
FLUSH PRIVILEGES;
```

### 4. Configure Environment

Copy the sample environment file and make it readable only by you:

```bash
cp .env.example .env
chmod 600 .env
```

VULNZ refuses to start without `.env`, and lists every problem at once when a critical setting is wrong:

- `DB_HOST`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` must be set, and not left at their placeholder values.
- All six `PASSWORD_MIN_*` settings must be whole numbers (`PASSWORD_MIN_LENGTH` at least 1), so the password policy can never be silently switched off.
- `VULNZ_NOTIFY_SECRET` may be left unset, which keeps the notification endpoints closed, but not at its `CHANGE_ME` placeholder.

The server also refuses to start if `.env` is readable by anyone but its owner. Both the server and the CLI read `.env` from the project root, whatever directory they are run from.

Edit `.env` and configure at minimum:

```plaintext
# Database connection
DB_HOST=localhost
DB_USER=vulnz
DB_PASSWORD=your-secure-password
DB_NAME=vulnz

# Server configuration
HTTP_LISTEN_PORT=3000
BASE_URL=http://localhost:3000
```

See the [Configuration Reference](configuration.md) for every other setting. Two worth setting now: `CRON_ENABLE=true` to run the scheduled jobs, and `SMTP_ENABLED=true` with the `SMTP_*` settings on a server that should send email.

### 5. Start the Application

For development:

```bash
npm run dev
```

For production, set `NODE_ENV=production` in `.env` (there is no build step):

```bash
npm start
```

### 6. Create Administrator Account

The first admin account **must be created via the CLI** — there is no web-based setup mode. This ensures only someone with shell access to the server can bootstrap the application.

```bash
./bin/vulnz user:add admin@example.com 'a-strong-password' --admin
```

The email address is the username. The password must meet the `PASSWORD_MIN_*` policy. The `--admin` flag grants the administrator role. Then generate the account's API key with `./bin/vulnz key:generate admin@example.com`. See the [CLI Reference](cli.md).

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
├── bin/vulnz              # Admin CLI
├── public/                # Favicon and robots.txt for the landing page
├── data/                  # Reference data for REFERENCE_UPDATE_METHOD=file
├── tests/                 # Test files
├── scripts/               # Utility scripts
├── .env                   # Environment configuration (create this)
├── package.json           # Dependencies
└── README.md             # Project overview
```

---

## Post-Installation

### Create User Accounts

There is no public registration. Create each account with the CLI, then give it an API key:

```bash
./bin/vulnz user:add alice@example.com 'a-strong-password'
./bin/vulnz key:generate alice@example.com
```

### Configure Email (Optional)

To enable weekly vulnerability reports, configure SMTP and switch email on with `SMTP_ENABLED=true`. It is off by default, and no email of any kind is sent until it is set:

```plaintext
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM=vulnz@example.com
```

### Test Email

Check the SMTP settings first with a plain test message. This works even while `SMTP_ENABLED` is still `false`, so you can try them before the server starts sending anything:

```bash
./bin/vulnz email:test you@example.com
```

Once that works and `SMTP_ENABLED=true` is set, you can send a real summary report to yourself with the API:

```bash
curl -X POST "http://localhost:3000/api/reports/summary-email" \
  -H "X-API-Key: your-api-key" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

With an empty body the report goes to the key holder's own account. A `Report sent` response means SMTP accepted it. An account with no websites gets no report, weekly or on demand: the response is `Report not sent: no websites on this account`. With `SMTP_ENABLED` off the request is refused with 503 and nothing is sent.

An administrator can send another user's report by naming them with `user_id` or `username` (give one, not both). Because that emails the client and everyone on their CC list, it must be confirmed with `"send": true`; without it the request is refused and nothing is sent:

```bash
curl -X POST "http://localhost:3000/api/reports/summary-email" \
  -H "X-API-Key: your-admin-api-key" \
  -H 'Content-Type: application/json' \
  -d '{"username": "client@example.com", "send": true}'
```

To see what a client will receive without emailing anyone, fetch the preview instead:

```bash
curl "http://localhost:3000/api/reports/summary-email/preview?username=client@example.com" \
  -H "X-API-Key: your-admin-api-key"
```

It returns JSON with the `subject`, the `html` and a plain-text `text` rendering of the report exactly as the weekly email would build it, plus the `delivery` it would use (`to`, `cc`, weekday, paused, blocked). `would_send` is `false` when the weekly job would skip the account, and `skip_reasons` lists why: `no_websites`, `blocked`, `paused` or `no_weekday`. With no websites there is no report to render, so `subject`, `html` and `text` are `null`. Nothing is sent and nothing is written to the email log.

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

See [Database Setup](database-setup.md) for more details on backups.

---

## Verification

### Check Database Tables

After starting the application, verify tables were created:

```bash
mysql -u vulnz -p vulnz -e "SHOW TABLES;"
```

Expected tables:

- `users`, `roles`, `user_roles`, `api_keys`
- `websites`, `website_components`
- `components`, `component_types`, `releases`, `vulnerabilities`
- `security_events`, `security_event_types`
- `app_settings`
- `migrations`

There are more; see the [Database Schema](contributing/database-schema.md).

### Check Migrations

Verify all migrations ran successfully:

```bash
mysql -u vulnz -p vulnz -e "SELECT * FROM migrations ORDER BY created_at;"
```

### Verify the Service

VULNZ is headless — there is no UI to log in to. Navigate to `http://localhost:3000` and verify:

- The status landing page responds (it content-negotiates, so `Accept: application/json` returns JSON)
- API documentation at `/doc` is available, and the OpenAPI spec at `/openapi.json` parses. With `NODE_ENV=production` both need an administrator API key in the `X-API-Key` header.

### Test API

```bash
# Get OpenAPI spec (add -H "X-API-Key: ..." with an administrator key in production)
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

### VULNZ Cannot Start

**Error**: `VULNZ cannot start: the environment is not configured.`

**Solution**: Fix each setting the message lists. It names every problem at once. See [Required Variables](configuration.md#required-variables).

### Creating Users

There is no self-service registration. Create accounts with the CLI: `./bin/vulnz user:add <email> <password>`.

### Migrations Not Running

**Issue**: Tables not created on startup

**Solution**:

- Check logs for migration errors
- Verify database user has CREATE TABLE privileges
- Run the migrations directly, without starting the server:
  ```bash
  ./bin/vulnz db:migrate
  ```
  See the [CLI Reference](cli.md#dbmigrate---json). Migrations are forward-only and tracked in the `migrations` table — there is no rollback.

---

## Next Steps

- [Configure](configuration.md) additional settings
- Explore the [API](api-usage.md)
