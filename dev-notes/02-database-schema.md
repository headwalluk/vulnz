# Database Schema

Complete database schema reference for VULNZ.

---

## Overview

VULNZ uses MySQL/MariaDB with a relational schema. All tables use `BIGINT UNSIGNED` for IDs and foreign keys. Timestamps use `TIMESTAMP` type with automatic updates.

### Entity Relationship Overview

```
users ──┬── api_keys
        ├── websites ──┬── website_components ── releases ── vulnerabilities
        │              ├── security_events
        │              ├── file_security_issues
        │              └── component_changes
        ├── user_roles ── roles
        ├── sessions
        ├── password_reset_tokens
        └── email_logs

components ──┬── releases ──┬── vulnerabilities
             │              └── website_components
             └── component_types

app_settings (global configuration)
api_call_logs (audit trail)
migrations (schema version tracking)
```

---

## Core Tables

### users

User accounts for the system.

```sql
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  enable_white_label BOOLEAN NOT NULL DEFAULT FALSE,
  white_label_html TEXT NULL,
  reporting_weekday INT DEFAULT 1,
  reporting_hour INT DEFAULT 9,
  report_email VARCHAR(255) NULL,
  last_summary_sent_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY reporting_weekday_idx (reporting_weekday)
);
```

**Key Fields:**

- `blocked`: Account completely disabled
- `paused`: Temporarily suspended (can be unpaused)
- `enable_white_label`: Use custom branding in email reports
- `white_label_html`: Custom HTML for email header (max 16KB)
- `reporting_weekday`: Day of week for reports (1=Monday, 7=Sunday)
- `reporting_hour`: Hour of day for reports (0-23)
- `report_email`: Override email for reports (defaults to user email)

### roles

Role definitions (administrator, user).

```sql
CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Default Roles:**

- `administrator`: Full system access
- `user`: Standard user access

### user_roles

Many-to-many relationship between users and roles.

```sql
CREATE TABLE user_roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE KEY user_role (user_id, role_id)
);
```

### api_keys

API keys for programmatic access.

```sql
CREATE TABLE api_keys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  api_key VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### sessions

User sessions (managed by express-session).

```sql
CREATE TABLE sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  expires BIGINT UNSIGNED NOT NULL,
  data TEXT,
  KEY expires_idx (expires)
);
```

### password_reset_tokens

Tokens for password reset functionality.

```sql
CREATE TABLE password_reset_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## Component Tables

### component_types

Types of components (wordpress-plugin, wordpress-theme).

```sql
CREATE TABLE component_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Default Types:**

- `wordpress-plugin`: WordPress plugins
- `wordpress-theme`: WordPress themes

### components

WordPress plugins and themes tracked in the system.

```sql
CREATE TABLE components (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(255) NOT NULL,
  component_type_slug VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description VARCHAR(4096) NULL,
  synced_from_wporg TINYINT(1) DEFAULT 0,
  sync_priority_slug VARCHAR(50) NOT NULL DEFAULT 'low',
  latest_version VARCHAR(255) NULL,
  latest_version_at DATETIME NULL,
  wporg_available TINYINT(1) NULL,
  is_malware TINYINT(1) NOT NULL DEFAULT 0,
  malware_summary VARCHAR(255) NULL,
  malware_url VARCHAR(255) NULL,
  malware_source_slug VARCHAR(50) NULL,
  malware_flagged_at DATETIME NULL,
  url VARCHAR(255) NULL,
  added DATE NULL,
  last_updated DATETIME NULL,
  requires_php VARCHAR(10) NULL,
  tested VARCHAR(10) NULL,
  synced_from_wporg_at DATETIME NULL,
  UNIQUE KEY slug (slug, component_type_slug),
  KEY idx_wporg_sync (component_type_slug, synced_from_wporg, synced_from_wporg_at),
  KEY idx_components_priority (component_type_slug, sync_priority_slug),
  KEY idx_components_malware (component_type_slug, is_malware),
  FULLTEXT KEY components_slug_IDX (slug, title),
  FOREIGN KEY (component_type_slug) REFERENCES component_types(slug),
  FOREIGN KEY (sync_priority_slug) REFERENCES sync_priorities(slug),
  FOREIGN KEY (malware_source_slug) REFERENCES malware_sources(slug)
);
```

**Key Fields:**

- `component_type_slug`: components are keyed by type **slug**, not a type id, and `(slug, component_type_slug)` is the natural key the ingest path upserts on.
- `added` / `last_updated` / `requires_php` / `tested` / `synced_from_wporg_at`: metadata synced from wordpress.org.
- `sync_priority_slug`: which sync lane the component is in — `high` is the hourly watchlist sweep, `low` the background rotation (M12).
- `latest_version` / `latest_version_at`: current release per wordpress.org, cached here so the fleet manifest is a direct indexed read rather than a `MAX()` over `releases`.
- `wporg_available`: `NULL` unknown / `1` seen on wordpress.org / `0` absent (404). Distinct from `synced_from_wporg`, which only says whether a sync was attempted.
- `is_malware` / `malware_summary` / `malware_url` / `malware_source_slug` / `malware_flagged_at`: the known-malware verdict (M14). Component-level rather than per-release, because malware is a property of the artefact — every version is bad, including versions ingested after the flag was set. Set via the CLI only; no API route writes these columns. `malware_url` is an optional link to a write-up, left NULL rather than derived from the slug so that a customer-facing alert never carries a 404. See [`15-known-malware.md`](15-known-malware.md).

> **Note:** this table's definition has been verified against the live schema as of v1.34.0. Other tables in this document may still have drifted — see the snag list.

### releases

Specific versions of components.

```sql
CREATE TABLE releases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  component_id BIGINT UNSIGNED NOT NULL,
  version VARCHAR(255) NOT NULL,
  release_date DATE,
  changelog MEDIUMTEXT,
  is_urgent TINYINT(1) NOT NULL DEFAULT 0,
  urgency_summary VARCHAR(255),
  urgency_source_slug VARCHAR(50),
  urgency_checked_at DATETIME,
  FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
  FOREIGN KEY (urgency_source_slug) REFERENCES urgency_sources(slug),
  UNIQUE KEY component_id_version_unique (component_id, version),
  INDEX idx_releases_urgency_checked (urgency_checked_at)
);
```

**Key Fields (M13 — urgent update classification):**

- `changelog`: wordpress.org changelog HTML, captured at sync time. Populated **only** for high-priority (watchlist) components — it is the classifier's input and the audit trail for its verdict.
- `is_urgent`: whether this release fixes a vulnerability exploitable against a default installation. Served by the fleet manifest; defaults to `0` in every uncertain case.
- `urgency_checked_at`: `NULL` means "pending classification" — this column _is_ the work queue.

### urgency_sources

Lookup table for how a release's urgency verdict was reached.

```sql
CREATE TABLE urgency_sources (
  slug VARCHAR(50) NOT NULL PRIMARY KEY,
  title VARCHAR(100) NOT NULL
);
```

| slug               | Meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------- |
| `changelog_llm`    | Classified from the wordpress.org changelog by an LLM                       |
| `keyword_override` | Forced urgent by an unambiguous changelog keyword the model had not flagged |
| `manual`           | Set by hand via the CLI                                                     |
| `none`             | No signal available — changelog absent or classifier disabled               |

### vulnerabilities

Security vulnerabilities affecting specific releases.

```sql
CREATE TABLE vulnerabilities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  release_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);
```

**Note:** URLs point to external vulnerability databases (Wordfence, WPScan, etc.)

---

## Website Tables

### websites

WordPress websites monitored by users.

```sql
CREATE TABLE websites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  domain VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  is_ssl BOOLEAN DEFAULT TRUE,
  is_dev BOOLEAN NOT NULL DEFAULT FALSE,
  meta JSON,
  wordpress_version VARCHAR(50) NULL,
  php_version VARCHAR(50) NULL,
  db_server_type VARCHAR(50) DEFAULT 'unknown',
  db_server_version VARCHAR(50) NULL,
  versions_last_checked_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY user_website (user_id, domain),
  KEY domain_idx (domain)
);
```

**Key Fields:**

- `is_dev`: Development site (excluded from some reports)
- `meta`: Arbitrary JSON metadata
- `wordpress_version`, `php_version`, `db_server_*`: Software versions
- `versions_last_checked_at`: Last version update timestamp

### website_components

Tracks which component versions are installed on each website.

```sql
CREATE TABLE website_components (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id BIGINT UNSIGNED NOT NULL,
  release_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE,
  UNIQUE KEY website_release (website_id, release_id)
);
```

---

## Security Event Tables

### security_event_types

Types of security events that can be logged.

```sql
CREATE TABLE security_event_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Common Event Types:**

- `failed-login`: Failed login attempt
- `blocked-login`: Login blocked by security plugin
- `brute-force`: Brute force attack detected
- `firewall-block`: Firewall blocked request
- `malware-scan`: Malware detected in scan

### security_events

Individual security events logged from websites.

```sql
CREATE TABLE security_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id BIGINT UNSIGNED NOT NULL,
  event_type_id BIGINT UNSIGNED NOT NULL,
  event_datetime TIMESTAMP NOT NULL,
  source_ip VARCHAR(45) NOT NULL,
  country_code CHAR(2) NULL,
  username VARCHAR(255) NULL,
  user_agent TEXT NULL,
  meta JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  FOREIGN KEY (event_type_id) REFERENCES security_event_types(id) ON DELETE CASCADE,
  UNIQUE KEY dedup_constraint (website_id, event_type_id, source_ip, event_datetime)
);
```

**Key Features:**

- Unique constraint prevents duplicate events
- `country_code`: ISO 3166-1 alpha-2 (resolved from IP)
- `meta`: Additional event-specific data (JSON)

### file_security_issues

File-level security issues detected on websites.

```sql
CREATE TABLE file_security_issues (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id BIGINT UNSIGNED NOT NULL,
  file_path VARCHAR(1000) NOT NULL,
  issue_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  description TEXT,
  detected_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
);
```

**Issue Types:**

- `malware`: Malware detected
- `suspicious`: Suspicious code pattern
- `backdoor`: Backdoor detected
- `defaced`: File modification detected

**Severity Levels:**

- `critical`, `high`, `medium`, `low`, `info`

### component_changes

Audit log of plugin/theme installations, updates, and removals.

```sql
CREATE TABLE component_changes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id BIGINT UNSIGNED NOT NULL,
  component_type VARCHAR(50) NOT NULL,
  component_slug VARCHAR(255) NOT NULL,
  component_name VARCHAR(255) NOT NULL,
  change_type VARCHAR(50) NOT NULL,
  old_version VARCHAR(50) NULL,
  new_version VARCHAR(50) NULL,
  changed_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
);
```

**Change Types:**

- `installed`: New installation
- `updated`: Version update
- `activated`: Activated (was installed but inactive)
- `deactivated`: Deactivated (still installed)
- `removed`: Uninstalled

---

## System Tables

### app_settings

Global application settings (key-value store).

```sql
CREATE TABLE app_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(255) NOT NULL UNIQUE,
  setting_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Common Settings:**

- `last_wporg_sync_cursor`: Last processed component for wordpress.org sync
- `maintenance_mode`: Enable/disable maintenance mode

### api_call_logs

Audit trail of API calls.

```sql
CREATE TABLE api_call_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  status_code INT NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

### email_logs

Log of sent emails for debugging and tracking.

```sql
CREATE TABLE email_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  email_to VARCHAR(255) NOT NULL,
  email_subject VARCHAR(500) NOT NULL,
  email_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
```

**Email Types:**

- `vulnerability-report`: Weekly vulnerability report
- `password-reset`: Password reset email
- `test-email`: Test email from UI

**Status Values:**

- `sent`: Successfully sent
- `failed`: Failed to send

### migrations

Tracks which database migrations have been run.

```sql
CREATE TABLE migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Common Query Patterns

### Finding Vulnerable Websites

```sql
SELECT DISTINCT w.*
FROM websites w
JOIN website_components wc ON w.id = wc.website_id
JOIN releases r ON wc.release_id = r.id
JOIN vulnerabilities v ON r.id = v.release_id
WHERE w.user_id = ?
ORDER BY w.domain;
```

### Getting Website Components with Vulnerability Info

```sql
SELECT
  c.slug,
  c.name,
  r.version,
  ct.slug AS component_type,
  COUNT(v.id) AS vulnerability_count
FROM website_components wc
JOIN releases r ON wc.release_id = r.id
JOIN components c ON r.component_id = c.id
JOIN component_types ct ON c.type_id = ct.id
LEFT JOIN vulnerabilities v ON r.id = v.release_id
WHERE wc.website_id = ?
GROUP BY c.id, r.id;
```

### Recent Security Events by Country

```sql
SELECT
  country_code,
  COUNT(*) AS event_count,
  COUNT(DISTINCT source_ip) AS unique_ips
FROM security_events
WHERE website_id = ?
  AND event_datetime >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY country_code
ORDER BY event_count DESC;
```

---

## Migration Workflow

### Creating a New Migration

1. Create file: `src/migrations/YYYYMMDDHHMMSS-description.js`
2. Implement `up()` function:

```javascript
const db = require('../db');

async function up() {
  await db.query(`
    ALTER TABLE users 
    ADD COLUMN new_field VARCHAR(255) NULL
  `);
}

module.exports = { up };
```

3. Migrations run automatically on app startup
4. Track in `migrations` table

### Running Migrations

Migrations run automatically when the application starts. They are executed in alphabetical order (timestamp-based naming ensures correct order).

---

## Indexes

Key indexes for performance:

- `users`: `username`, `email` (UNIQUE)
- `websites`: `domain`, `user_website` composite (UNIQUE), `domain_idx`
- `components`: `type_slug` composite (UNIQUE)
- `releases`: `component_version` composite (UNIQUE)
- `security_events`: `dedup_constraint` composite (UNIQUE)
- `sessions`: `expires`
- `user_roles`: `reporting_weekday_idx`

---

## Backup Strategy

Use the provided backup script:

```bash
# Backup users and authentication data
./scripts/backup.sh --users

# Backup components and vulnerabilities
./scripts/backup.sh --components

# Backup everything
./scripts/backup.sh --all
```

Or use `mysqldump` directly:

```bash
mysqldump -u user -p vulnz > backup.sql
```

---

## Schema Evolution

- Always create migrations for schema changes
- Never modify existing migrations
- Test migrations on development database first
- Keep migrations small and focused
- Document breaking changes in CHANGELOG.md
