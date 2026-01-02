# Database Setup

Database configuration and management for VULNZ.

---

## Creating the Database

### MySQL/MariaDB

Create a dedicated database and user for VULNZ:

```sql
-- Create database
CREATE DATABASE vulnz CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user (replace 'password' with a strong password)
CREATE USER 'vulnz'@'localhost' IDENTIFIED BY 'strong-password-here';

-- Grant privileges
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'localhost';
FLUSH PRIVILEGES;
```

### Remote Database

If MySQL is on a different server:

```sql
-- Allow connection from specific IP
CREATE USER 'vulnz'@'192.168.1.100' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'192.168.1.100';

-- Or allow from any host (less secure)
CREATE USER 'vulnz'@'%' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON vulnz.* TO 'vulnz'@'%';

FLUSH PRIVILEGES;
```

---

## Migrations

VULNZ uses database migrations to manage schema changes. Migrations run automatically when the application starts.

### How Migrations Work

1. On startup, VULNZ checks the `migrations` table
2. Any migrations not yet run are executed in order
3. Completed migrations are recorded in the `migrations` table
4. Subsequent startups skip already-run migrations

### Migration Files

Located in `src/migrations/`, named with timestamps:

```
20251023114200-add-domain-index-to-websites.js
20251023192500-add-reporting-weekday-to-users.js
20251206100000-create-security-event-types-table.js
```

### Checking Migration Status

```bash
mysql -u vulnz -p vulnz -e "SELECT * FROM migrations ORDER BY created_at;"
```

Expected output:
```
+----+----------------------------------------------------------+---------------------+
| id | name                                                     | created_at          |
+----+----------------------------------------------------------+---------------------+
|  1 | 20251023114200-add-domain-index-to-websites.js          | 2025-10-23 11:42:00 |
|  2 | 20251023192500-add-reporting-weekday-to-users.js        | 2025-10-23 19:25:00 |
|  3 | 20251206100000-create-security-event-types-table.js     | 2025-12-06 10:00:00 |
...
```

### Manual Migration (Not Recommended)

Migrations should run automatically. If needed, you can run them manually:

```javascript
// In Node.js REPL
const migrations = require('./src/migrations');
migrations.run().then(() => console.log('Done')).catch(console.error);
```

---

## Database Schema

### Core Tables

- **users**: User accounts
- **roles**: User roles (administrator, user)
- **user_roles**: User-to-role mapping
- **api_keys**: API authentication keys
- **sessions**: User sessions

### Component Tables

- **component_types**: Types of components (wordpress-plugin, wordpress-theme)
- **components**: WordPress plugins and themes
- **releases**: Specific versions of components
- **vulnerabilities**: Known vulnerabilities
- **website_components**: Components installed on websites

### Website Tables

- **websites**: WordPress sites being monitored
- **security_events**: Security incidents (failed logins, attacks)
- **security_event_types**: Types of security events
- **file_security_issues**: File-level security problems
- **component_changes**: Plugin/theme installation/update log

### System Tables

- **app_settings**: Global configuration
- **api_call_logs**: API request audit trail
- **email_logs**: Email send history
- **password_reset_tokens**: Password reset tokens
- **migrations**: Migration tracking

---

## Backup Strategies

### Using Provided Script

VULNZ includes a backup script:

```bash
# Backup everything
./scripts/backup.sh --all

# Backup only user data
./scripts/backup.sh --users

# Backup only component/vulnerability data
./scripts/backup.sh --components
```

Backups are saved to `backups/` directory.

### Using mysqldump

#### Full Backup

```bash
mysqldump -u vulnz -p vulnz > vulnz-backup-$(date +%Y%m%d).sql
```

#### Compressed Backup

```bash
mysqldump -u vulnz -p vulnz | gzip > vulnz-backup-$(date +%Y%m%d).sql.gz
```

#### Specific Tables Only

```bash
mysqldump -u vulnz -p vulnz users websites api_keys > users-backup.sql
```

#### With Cron

Automate daily backups:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /path/to/vulnz && ./scripts/backup.sh --all
```

---

## Restore

### From mysqldump Backup

```bash
# Restore full backup
mysql -u vulnz -p vulnz < vulnz-backup-20260102.sql

# Restore from compressed backup
gunzip < vulnz-backup-20260102.sql.gz | mysql -u vulnz -p vulnz
```

### Restore Specific Tables

```bash
# Extract specific tables from backup
mysql -u vulnz -p vulnz < users-backup.sql
```

**Warning**: Restoring will overwrite existing data. Back up current database first.

---

## Performance Optimization

### Indexes

VULNZ creates indexes automatically during migrations. Key indexes:

- **users**: `username`, `email` (unique)
- **websites**: `domain`, composite `(user_id, domain)`
- **components**: composite `(type_id, slug)`
- **security_events**: composite deduplication constraint

### Query Performance

Check slow queries:

```sql
-- Enable slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- Log queries taking > 1 second

-- Check slow query log
SELECT * FROM mysql.slow_log ORDER BY start_time DESC LIMIT 10;
```

### Table Optimization

```sql
-- Optimize all VULNZ tables
USE vulnz;
OPTIMIZE TABLE users, websites, components, releases, vulnerabilities;
```

---

## Maintenance

### Cleanup Old Data

#### Security Events

Remove old security events (e.g., older than 90 days):

```sql
DELETE FROM security_events 
WHERE event_datetime < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

#### API Call Logs

```sql
DELETE FROM api_call_logs 
WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

#### Email Logs

```sql
DELETE FROM email_logs 
WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
```

### Check Database Size

```sql
SELECT 
  table_name AS 'Table',
  ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)'
FROM information_schema.TABLES
WHERE table_schema = 'vulnz'
ORDER BY (data_length + index_length) DESC;
```

---

## Troubleshooting

### Connection Issues

**Error**: `ER_ACCESS_DENIED_ERROR: Access denied for user 'vulnz'@'localhost'`

**Solutions**:
1. Verify credentials in `.env`
2. Check user exists:
   ```sql
   SELECT user, host FROM mysql.user WHERE user = 'vulnz';
   ```
3. Reset password:
   ```sql
   ALTER USER 'vulnz'@'localhost' IDENTIFIED BY 'new-password';
   FLUSH PRIVILEGES;
   ```

### Migration Failures

**Error**: Migration script fails during startup

**Solutions**:
1. Check MySQL error log for details
2. Verify database user has CREATE/ALTER privileges
3. Check for conflicting table/column names
4. Review migration file for syntax errors

### Table Already Exists

**Error**: `ER_TABLE_EXISTS_ERROR: Table 'users' already exists`

**Cause**: Running migrations twice or manual table creation

**Solution**: Migrations use `CREATE TABLE IF NOT EXISTS`, so this shouldn't happen. If it does:
1. Check `migrations` table to see what has run
2. Drop and recreate database if starting fresh
3. Contact support if data is present

### Locked Tables

**Error**: `Lock wait timeout exceeded`

**Cause**: Long-running query or transaction

**Solution**:
```sql
-- Show running queries
SHOW PROCESSLIST;

-- Kill long-running query (use ID from SHOW PROCESSLIST)
KILL <process_id>;
```

---

## Security

### Principle of Least Privilege

Only grant necessary privileges:

```sql
-- Minimal production privileges
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
ON vulnz.* TO 'vulnz'@'localhost';

-- Don't grant: DROP, SUPER, FILE, PROCESS
```

### Secure Connections

For remote databases, use SSL:

```sql
-- Require SSL for user
ALTER USER 'vulnz'@'%' REQUIRE SSL;
```

Update `.env`:
```plaintext
DB_SSL=true
```

### Regular Audits

Review user privileges periodically:

```sql
SHOW GRANTS FOR 'vulnz'@'localhost';
```

---

## Database Upgrades

When upgrading MySQL/MariaDB:

1. **Backup first**: Always backup before upgrading
2. **Test migrations**: Run VULNZ against new version in staging
3. **Check compatibility**: Verify your queries work
4. **Monitor performance**: Some versions change query optimization

---

## Next Steps

- [Install VULNZ](installation.md)
- [Configure Environment](configuration.md)
- [Set Up Backups](backup-restore.md)
- [Deploy to Production](deployment.md)
