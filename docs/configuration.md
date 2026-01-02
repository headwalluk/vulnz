# Configuration Reference

Complete environment variable reference for VULNZ.

---

## Environment File

All configuration is stored in the `.env` file in the root directory.

**Never commit `.env` to version control**. Use `env.sample` as a template.

---

## Required Variables

### Database Configuration

```plaintext
DB_HOST=localhost
DB_PORT=3306
DB_USER=vulnz
DB_PASSWORD=your-database-password
DB_NAME=vulnz
```

- **DB_HOST**: MySQL/MariaDB server hostname
- **DB_PORT**: Database port (default: 3306)
- **DB_USER**: Database username
- **DB_PASSWORD**: Database password
- **DB_NAME**: Database name

### Server Configuration

```plaintext
HTTP_LISTEN_PORT=3000
BASE_URL=http://localhost:3000
```

- **HTTP_LISTEN_PORT**: Port for the application to listen on
- **BASE_URL**: Public-facing URL (important for reverse proxy setups)

### Security

```plaintext
SESSION_SECRET=your-session-secret-here
```

- **SESSION_SECRET**: Cryptographic secret for session cookies
- **Must be**: 32+ characters, random, unique per installation
- **Generate with**: `bash scripts/generate-session-secret.sh`

---

## Optional Variables

### Setup & Registration

```plaintext
SETUP_MODE=false
REGISTRATION_ENABLED=false
```

- **SETUP_MODE**: When `true`, first registered user becomes administrator
  - **Default**: `false`
  - **Set to `true`**: Only for initial setup
  - **Set to `false`**: After creating admin account

- **REGISTRATION_ENABLED**: Allow public user registration
  - **Default**: `false`
  - **Set to `true`**: Allow self-service registration
  - **Set to `false`**: Admin-only user creation

### Rate Limiting

```plaintext
UNAUTH_SEARCH_LIMIT_PER_SECOND=1
```

- **UNAUTH_SEARCH_LIMIT_PER_SECOND**: Max unauthenticated search requests per second
  - **Default**: `1`
  - **Disable**: Set to `0`
  - **Purpose**: Prevent abuse of public search API

### CORS Configuration

```plaintext
CORS_ENABLED=false
CORS_ORIGIN=https://example.com,https://app.example.com
CORS_CREDENTIALS=true
```

- **CORS_ENABLED**: Enable cross-origin API access
  - **Default**: `false`
  - **Set to `true`**: When building browser-based clients

- **CORS_ORIGIN**: Allowed origins (comma-separated)
  - **Default**: `*` (all origins)
  - **Production**: Always specify exact origins
  - **Development**: Can use `*` for testing

- **CORS_CREDENTIALS**: Allow credentials (cookies, auth headers)
  - **Default**: `false`
  - **Set to `true`**: When using API keys or session cookies

### Email Configuration

```plaintext
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=vulnz@example.com
```

- **SMTP_HOST**: SMTP server hostname
- **SMTP_PORT**: SMTP port (587 for STARTTLS, 465 for SSL)
- **SMTP_SECURE**: Use SSL/TLS
  - `true`: Port 465 (SMTPS)
  - `false`: Port 587 (STARTTLS)
- **SMTP_USER**: SMTP username
- **SMTP_PASSWORD**: SMTP password
- **SMTP_FROM**: Sender email address

**Common SMTP Providers:**

- **Gmail**:

  ```plaintext
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_SECURE=false
  ```

- **SendGrid**:

  ```plaintext
  SMTP_HOST=smtp.sendgrid.net
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=apikey
  SMTP_PASSWORD=your-sendgrid-api-key
  ```

- **Mailgun**:
  ```plaintext
  SMTP_HOST=smtp.mailgun.org
  SMTP_PORT=587
  SMTP_SECURE=false
  ```

### WordPress.org Sync

```plaintext
REFERENCE_UPDATE_METHOD=api
```

- **REFERENCE_UPDATE_METHOD**: How to fetch wordpress.org metadata
  - `api`: Fetch from wordpress.org API (recommended)
  - `disabled`: Don't sync (faster startup, but missing metadata)
  - **Default**: `disabled`

### Security & Advanced

```plaintext
SKIP_STARTUP_FILEMODE_CHECKS=false
NODE_ENV=production
```

- **SKIP_STARTUP_FILEMODE_CHECKS**: Skip .env permission checks
  - **Default**: `false`
  - **Set to `true`**: Only on Windows or special cases
  - **Security Risk**: Others may read your .env file

- **NODE_ENV**: Application environment
  - `production`: Production mode
  - `development`: Development mode
  - **Auto-detected**: Based on pm2/process environment

---

## Example Configurations

### Development

```plaintext
# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=vulnz_dev
DB_PASSWORD=dev_password
DB_NAME=vulnz_dev

# Server
HTTP_LISTEN_PORT=3000
BASE_URL=http://localhost:3000

# Security
SESSION_SECRET=dev-secret-only-for-local-testing-not-secure

# Setup
SETUP_MODE=true
REGISTRATION_ENABLED=true

# Features
UNAUTH_SEARCH_LIMIT_PER_SECOND=10
CORS_ENABLED=true
CORS_ORIGIN=*

# Sync
REFERENCE_UPDATE_METHOD=api
```

### Production

```plaintext
# Database
DB_HOST=db.example.com
DB_PORT=3306
DB_USER=vulnz_prod
DB_PASSWORD=strong-random-password-here
DB_NAME=vulnz

# Server
HTTP_LISTEN_PORT=3000
BASE_URL=https://vulnz.example.com

# Security
SESSION_SECRET=48-character-cryptographically-random-string

# Setup (after initial setup)
SETUP_MODE=false
REGISTRATION_ENABLED=false

# Rate Limiting
UNAUTH_SEARCH_LIMIT_PER_SECOND=1

# CORS (if needed)
CORS_ENABLED=true
CORS_ORIGIN=https://example.com,https://app.example.com
CORS_CREDENTIALS=true

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=vulnz@example.com
SMTP_PASSWORD=smtp-password-here
SMTP_FROM=vulnz@example.com

# Sync
REFERENCE_UPDATE_METHOD=api

# Environment
NODE_ENV=production
```

---

## Environment Variable Loading

Variables are loaded in this order (later values override earlier):

1. System environment variables
2. `.env` file
3. PM2 ecosystem file (if using PM2)

---

## Security Best Practices

### File Permissions

Ensure `.env` is readable only by the application user:

```bash
chmod 600 .env
chown vulnz:vulnz .env
```

VULNZ checks this automatically on startup and warns if permissions are too open.

### Secrets Management

**Never:**

- Commit `.env` to version control
- Share `.env` file in plain text
- Log environment variables containing secrets
- Use weak or default secrets in production

**Always:**

- Generate random secrets with sufficient entropy
- Use different secrets for each environment
- Rotate secrets periodically
- Store backups of `.env` securely (encrypted)

### Access Control

- Limit database user privileges to only what's needed
- Use separate database users for development and production
- Don't use root/admin database credentials

---

## Validation

VULNZ validates configuration on startup and will:

- **Error and exit** if required variables are missing
- **Warn** about insecure configurations
- **Normalize** values (trim whitespace, parse booleans)

Check startup logs for configuration warnings.

---

## Troubleshooting

### Database Connection Errors

**Check:**

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` are correct
- Database server is running
- Database user has necessary privileges
- Firewall allows connection to database port

### Session Errors

**Issue**: `Warning: connect.session() MemoryStore is not designed for production use`

**Solution**: SESSION_SECRET is missing or invalid. Generate a new one:

```bash
bash scripts/generate-session-secret.sh
```

### Email Not Sending

**Check:**

- SMTP credentials are correct
- SMTP server allows connections from your IP
- Firewall allows outbound connections on SMTP port
- SMTP_FROM domain matches authenticated domain (some providers require this)

### CORS Issues

**Issue**: Browser blocks API requests

**Solution**:

1. Set `CORS_ENABLED=true`
2. Add requesting origin to `CORS_ORIGIN`
3. If sending credentials, set `CORS_CREDENTIALS=true`

---

## PM2 Ecosystem File

When using PM2, you can also set environment variables in `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'vulnz',
      script: 'src/index.js',
      instances: 4,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        HTTP_LISTEN_PORT: 3000,
      },
    },
  ],
};
```

Note: Sensitive values (passwords, secrets) should still be in `.env`, not the ecosystem file.

---

## Next Steps

- Review [Installation Guide](installation.md)
- Set up [Production Deployment](deployment.md)
- Configure [Weekly Reports](weekly-reports.md)
- Explore [API Usage](api-usage.md)
