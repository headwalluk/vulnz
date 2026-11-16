# Configuration Reference

Complete environment variable reference for VULNZ.

---

## Environment File

All configuration is stored in the `.env` file in the project root. Both the server and the CLI read it from there, whatever directory they are run from.

**Never commit `.env` to version control**. Copy `.env.example`, which documents every variable, and make it readable only by its owner:

```bash
cp .env.example .env
chmod 600 .env
```

A variable already set in the real environment (a shell export, a PM2 ecosystem file's `env` block) always wins over `.env`. Keep every setting in `.env` so there is one place to look. See [PM2 Ecosystem File](#pm2-ecosystem-file).

All scheduled times below are UTC: the server and the CLI run with `TZ=UTC`.

---

## Required Variables

VULNZ refuses to start while any of these is missing or malformed, and lists every problem at once.

### Database

```plaintext
DB_HOST=localhost
DB_USER=vulnz
DB_PASSWORD=your-database-password
DB_NAME=vulnz
```

- **DB_HOST**: MySQL/MariaDB server hostname
- **DB_USER**: Database username
- **DB_PASSWORD**: Database password
- **DB_NAME**: Database name

None may be left at its `YOUR_..._HERE` placeholder from `.env.example`. The connection always uses the server's default port, 3306.

### Password Policy

```plaintext
PASSWORD_MIN_LENGTH=8
PASSWORD_MIN_ALPHA=1
PASSWORD_MIN_SYMBOLS=1
PASSWORD_MIN_NUMERIC=1
PASSWORD_MIN_UPPERCASE=1
PASSWORD_MIN_LOWERCASE=1
```

The minimum length, and the minimum count of letters, symbols, digits, uppercase and lowercase characters, for passwords set through the API or the CLI. Each must be a whole number; `PASSWORD_MIN_LENGTH` must be at least `1`. There are no defaults, so the policy can never be switched off by accident.

---

## Server

```plaintext
NODE_ENV=production
HTTP_LISTEN_PORT=3000
BASE_URL=https://vulnz.example.com
# JSON_BODY_LIMIT=1mb
```

- **NODE_ENV**: `production` or `development`
  - `production`: `/doc` and `/openapi.json` require an administrator API key, and the stricter security headers apply
  - `development`: the API documentation is public
  - **Default**: `development`, with a startup warning, when unset or unrecognised
- **HTTP_LISTEN_PORT**: Port to listen on
  - **Default**: `3000`
- **BASE_URL**: Public-facing URL. Used as the server URL in the OpenAPI spec, in the startup log, and in `GET /api/config`. Set it to the proxy's URL when running behind a reverse proxy
- **JSON_BODY_LIMIT**: Maximum JSON request body, in any format the `bytes` library accepts (`100kb`, `1mb`, `5mb`)
  - **Default**: Express's `100kb`
  - Raise it if the bulk vulnerability or release endpoints reject large payloads

### File Permissions Check

```plaintext
# SKIP_STARTUP_FILEMODE_CHECKS=false
```

- **SKIP_STARTUP_FILEMODE_CHECKS**: The server refuses to start unless `.env` has mode `0600`. Set to `true` to skip the check
  - **Default**: `false`
  - Not recommended: other users on the host may be able to read your secrets

### CORS

```plaintext
CORS_ENABLED=false
CORS_ORIGIN=https://example.com,https://app.example.com
CORS_CREDENTIALS=true
```

- **CORS_ENABLED**: Allow cross-origin browser access. Only the exact value `true` enables it
  - **Default**: `false`
- **CORS_ORIGIN**: Allowed origins, comma-separated, or `*` for any
  - **Default**: `*`
  - In production, always list exact origins
- **CORS_CREDENTIALS**: Send `Access-Control-Allow-Credentials: true`, for browser clients that make requests with `credentials: 'include'` (cookies or HTTP authentication). The `X-API-Key` header is allowed without it
  - **Default**: `false`

### Rate Limiting

```plaintext
UNAUTH_SEARCH_LIMIT_PER_SECOND=1
# UNAUTH_SEARCH_WINDOW_SECONDS=10
```

Applies to unauthenticated requests to the public endpoints (search, ecosystems, component types). Authenticated callers are not limited.

- **UNAUTH_SEARCH_LIMIT_PER_SECOND**: Sustained requests per second per client
  - **Default**: `1`
  - **Disable**: Set to `0`
- **UNAUTH_SEARCH_WINDOW_SECONDS**: The window the limit is counted over. At the defaults a client may make 10 requests back to back, then must wait, which suits a search-as-you-type box
  - **Default**: `10`
  - **Minimum**: `1`

### Pagination and Limits

```plaintext
LIST_PAGE_SIZE=10
API_MAX_PAGE_SIZE=200
MAX_API_KEYS_PER_USER=10
```

- **LIST_PAGE_SIZE**: Default page size for `GET /api/components` when the caller sends no `limit`
  - **Default**: `10`
  - **Minimum**: `1`
  - `GET /api/websites` has its own default of `10` and does not read this
- **API_MAX_PAGE_SIZE**: Upper bound on `?limit=` for list endpoints
  - **Default**: `200`
  - **Minimum**: `1`
  - A request above this is rejected with `400`, not silently clamped: a response that quietly used a different page size than the one asked for is indistinguishable from a correct one
  - Raising it mainly costs payload, not query time: each website in `GET /api/websites` carries its full plugin and theme lists, around 5.9 KB
- **MAX_API_KEYS_PER_USER**: Ceiling on each account's API key allowance. When set, an account's `max_api_keys` is capped at this value whenever it is created or changed
  - **Default**: unset, no ceiling. A new account is allowed `1` key unless told otherwise

### Logging

```plaintext
LOG_LEVEL=info
API_LOG_RETENTION_DAYS=7
```

- **LOG_LEVEL**: `debug`, `info`, `warn` or `error`
  - `debug`: per-request and per-cron-tick detail, such as each website sync's component changes
  - `info`: outcomes of routine work and startup progress
  - `warn`: only what an operator should see (urgent releases, malware alerts sent, invalid settings), plus every warning and error
  - `error`: failures only
  - **Default**: `info`
- **API_LOG_RETENTION_DAYS**: Days of API call logs to keep. Purged daily at 00:00
  - **No default**: while unset, logs are never purged and a warning is logged each night

---

## Background Jobs

```plaintext
CRON_ENABLE=true
```

- **CRON_ENABLE**: Run the scheduled jobs: wordpress.org syncs, weekly reports, log purges, notification delivery, reference data, LLM classification and stale website deletion
  - **Default**: `false`. `.env.example` sets it to `true`
  - Under PM2 cluster mode only instance `0` schedules jobs. See [PM2 Ecosystem File](#pm2-ecosystem-file)

---

## Email

```plaintext
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASS=your-smtp-password
SMTP_FROM="VULNZ <noreply@example.com>"
# SMTP_IGNORE_TLS=false
# EMAIL_LOG_MAX_AGE_DAYS=14
```

- **SMTP_ENABLED**: Master switch for outgoing email (weekly reports and malware alerts)
  - **Default**: `false`, so no email is sent until you turn it on
  - **Set to `true`**: In production. Leave it off on any host that holds a copy of production data, so customers are never emailed from it
  - While it is off, weekly reports are skipped, malware alerts wait unsent and are sent once it is on, and `POST /api/reports/summary-email` returns 503. The server prints a warning at startup
  - `./bin/vulnz email:test <to>` sends a test email even while it is off. See [CLI Reference](cli.md#emailtest-to---json)
- **SMTP_HOST**: SMTP server hostname
- **SMTP_PORT**: SMTP port, normally `587`. The connection starts unencrypted and upgrades with STARTTLS when the server offers it. Port 465 (implicit TLS, "SMTPS") is not supported
- **SMTP_USER** / **SMTP_PASS**: SMTP credentials. Leave both unset for a server that needs no login
- **SMTP_FROM**: Sender address, optionally with a display name
- **SMTP_IGNORE_TLS**: Set to `true` to accept an SMTP server's certificate without verifying it, for local servers with self-signed certificates. It does not turn encryption off
  - **Default**: `false`. Never set it in production
- **EMAIL_LOG_MAX_AGE_DAYS**: Days of email send logs to keep. Purged at 00:00 and 12:00
  - **Default**: `14`

**Common SMTP Providers:**

- **Gmail**:

  ```plaintext
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  ```

- **SendGrid**:

  ```plaintext
  SMTP_HOST=smtp.sendgrid.net
  SMTP_PORT=587
  SMTP_USER=apikey
  SMTP_PASS=your-sendgrid-api-key
  ```

- **Mailgun**:
  ```plaintext
  SMTP_HOST=smtp.mailgun.org
  SMTP_PORT=587
  ```

### Weekly Reports

```plaintext
REPORTING_HOUR=9
REPORTING_BATCH_SIZE=5
# REPORTING_HEADING='Weekly Website Vulnerability Report'
# REPORTING_OPENING_PARAGRAPH='Here is the weekly vulnerability report...'
# REPORTING_CLOSING_PARAGRAPH='Please keep all your WordPress components up to date...'
# REPORTING_SIGN_OFF='The VULNZ Team'
# REPORTING_POST_SCRIPT='If you have any questions, reply to this email.'
```

Each account chooses the weekday its report goes out. A job runs every 10 minutes and sends the reports due that day.

- **REPORTING_HOUR**: The hour (0–23, UTC) from which the day's reports are sent
  - **No default**: while unset or invalid, no weekly reports are sent and an error is logged each run
- **REPORTING_BATCH_SIZE**: Maximum reports sent per run, which spreads a large day's sending over several runs
  - **Default**: `10`
- **REPORTING_HEADING**, **REPORTING_OPENING_PARAGRAPH**, **REPORTING_CLOSING_PARAGRAPH**, **REPORTING_SIGN_OFF**, **REPORTING_POST_SCRIPT**: The report email's wording
  - **Defaults**: "Website vulnerability report"; "Here is your weekly vulnerability report for your WordPress plugins and themes:"; "This email does not contain any clickable links. To investigate your websites further, log in to your VULNZ account."; "The VULNZ Team"; "Stay safe online!"

### Known Malware Alerts

```plaintext
# MALWARE_ALERT_ENABLED=false
# MALWARE_ALERT_EMAIL='security@example.com'
```

An immediate email the first time a component flagged as known malware is reported on a website. Alerts are deduplicated per website and component: later syncs stay quiet, and a component that is removed and later reappears alerts again. Detections are recorded and reported by `GET /api/websites/malware` whether or not alerts are on.

- **MALWARE_ALERT_ENABLED**: Send the alerts
  - **Default**: `false`
  - Also needs `SMTP_ENABLED=true`. Alerts held back while email is off are sent once it is on
- **MALWARE_ALERT_EMAIL**: The operator's address, which receives every alert whichever account owns the website. The owning account's reporting CC list also gets the alert, as a separate email, so this address is never shown to them. The account owner is not emailed
  - **Default**: unset, so only the CC lists are alerted. The server warns at startup if alerts are on without it

---

## WordPress.org Sync

```plaintext
WPORG_UPDATE_BATCH_SIZE=10
WPORG_API_BASE_URL=https://api.wordpress.org
WPORG_PLUGIN_INFO_ENDPOINT=/plugins/info/1.0/
WPORG_TIMEOUT_MS=5000
WPORG_USER_AGENT=VULNZ/1.0 (+https://vulnz.example.com)
WPORG_RESYNC_DAYS=7
WPORG_WATCHLIST_SIZE=20
WPORG_WATCHLIST_SCAN_LIMIT=100
WPORG_HIGH_PRIORITY_DELAY_MS=250
```

- **WPORG_UPDATE_BATCH_SIZE**: Plugins synced from wordpress.org per run of the every-minute sync
  - **Default**: `1`
- **WPORG_API_BASE_URL**: wordpress.org API base URL
  - **Default**: `https://api.wordpress.org`
- **WPORG_PLUGIN_INFO_ENDPOINT**: Plugin information endpoint, relative to the base URL
  - **Default**: `/plugins/info/1.0/`
- **WPORG_TIMEOUT_MS**: Per-request timeout
  - **Default**: `5000`
  - **Minimum**: `1000`
- **WPORG_USER_AGENT**: `User-Agent` sent to wordpress.org
  - **Default**: `VULNZ/1.0`
- **WPORG_RESYNC_DAYS**: Plugins not synced for this many days are queued for a fresh sync. Checked daily at 02:00
  - **Default**: `7`
- **WPORG_WATCHLIST_SIZE**: Target number of plugins in the derived half of the high-priority watchlist, chosen by install count. The static list (`wporg:watchlist:static:*` CLI commands) is added on top. See [Fast Update Triggers](fast-update-triggers.md)
  - **Default**: `20`
- **WPORG_WATCHLIST_SCAN_LIMIT**: How far down the install-count ranking to look when filling the watchlist, leaving room to skip premium and closed plugins
  - **Default**: `100`
  - **Minimum**: `WPORG_WATCHLIST_SIZE`
- **WPORG_HIGH_PRIORITY_DELAY_MS**: Pause between requests in the hourly high-priority sync
  - **Default**: `250`
  - **Minimum**: `0`

### Reference Data

```plaintext
REFERENCE_UPDATE_METHOD=url
REFERENCE_UPDATE_LOCATION=https://example.com/reference.json
```

Loads version thresholds and other reference settings into the app settings, at startup and at 11:00 and 23:00.

- **REFERENCE_UPDATE_METHOD**: `url`, `file` or `disabled`
  - `url`: fetch from a remote URL
  - `file`: load from a local file, for development and testing
  - `disabled`: don't update reference data
  - **Default**: `disabled`
  - Any other value is an error
- **REFERENCE_UPDATE_LOCATION**: The URL or file path to load from. Required unless the method is `disabled`. `.env.example` points at `./data/reference.json`

---

## LLM Classification

Powers the `is_urgent` flag in the fast-update manifest — whether a plugin release is an emergency security fix or routine work. See [Fast Update Triggers](fast-update-triggers.md#urgent-updates).

```plaintext
LLM_ENABLED=false
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=anthropic/claude-haiku-4.5
OPENROUTER_MODEL_RELEASE_URGENCY=
LLM_TIMEOUT_MS=30000
LLM_MAX_ATTEMPTS=2
LLM_CLASSIFY_BATCH_SIZE=10
OPENROUTER_SITE_URL=
OPENROUTER_SITE_NAME=VULNZ
```

- **LLM_ENABLED**: Master switch for all LLM classification
  - **Default**: `false`
  - While false, nothing is classified and every release reports `is_urgent: false`, leaving hosts on their existing overnight update cycle
- **OPENROUTER_API_KEY**: Provider API key. Classification is skipped without it
- **OPENROUTER_BASE_URL**: Provider endpoint. OpenRouter speaks the OpenAI chat-completions shape, so an alternative compatible provider can be substituted here
  - **Default**: `https://openrouter.ai/api/v1`
- **OPENROUTER_MODEL**: Default model for every task
  - **Default**: `anthropic/claude-haiku-4.5`
  - Only watchlist releases are classified — roughly 50–60 calls a month — so cost is negligible whichever model you choose
- **OPENROUTER_MODEL_RELEASE_URGENCY**: Optional per-task override, if urgency classification should use a different model from other tasks
- **LLM_TIMEOUT_MS**: Per-request timeout
  - **Default**: `30000`
  - **Minimum**: `1000`
- **LLM_MAX_ATTEMPTS**: Attempts per classification, including the first. Only rate limits, timeouts and 5xx responses are retried
  - **Default**: `2`
  - **Range**: `1`–`5`
- **LLM_CLASSIFY_BATCH_SIZE**: Maximum releases classified per hourly run (at 20 minutes past)
  - **Default**: `10`
- **OPENROUTER_SITE_URL** / **OPENROUTER_SITE_NAME**: Optional attribution headers shown on the OpenRouter dashboard

---

## Notification Integration

```plaintext
VULNZ_NOTIFY_SECRET=a-64-character-hex-string
```

- **VULNZ_NOTIFY_SECRET**: Shared secret that WordPress/WooCommerce sites send in the `X-Vulnz-Secret` header on inbound notifications. Generate one with `openssl rand -hex 32`
  - **Default**: unset, which keeps the notification endpoints closed
  - VULNZ refuses to start while it still has the `CHANGE_ME` placeholder from `.env.example`, because that value is public

---

## Data Retention and Clean-Up

```plaintext
WEBSITE_AUTO_DELETE_ENABLED=false
WEBSITE_AUTO_DELETE_DAYS=30
GEOIP_DATABASE_PATH=/var/lib/GeoIP
```

- **WEBSITE_AUTO_DELETE_ENABLED**: Delete websites that have not been updated for `WEBSITE_AUTO_DELETE_DAYS`, daily at 00:00, with all their components and history. Only the exact value `true` enables it
  - **Default**: `false`. Watch `updated_at` for a while before turning it on
- **WEBSITE_AUTO_DELETE_DAYS**: Days without an update before a website is deleted
  - **Default**: `30`
- **GEOIP_DATABASE_PATH**: Directory holding the MaxMind `GeoLite2-City.mmdb` or `GeoLite2-Country.mmdb` database, used to locate the source of security events. Without it, events are stored without a location
  - **Default**: `/var/lib/GeoIP`

The retention periods for security events, file security issues and component changes are app settings. The env vars below are read only when the app setting is missing:

| App setting                           | Legacy env var                        | Default | Purged           |
| ------------------------------------- | ------------------------------------- | ------- | ---------------- |
| `retention.security_events_days`      | `SECURITY_EVENTS_RETENTION_DAYS`      | `30`    | Daily at 01:00   |
| `retention.file_security_issues_days` | `FILE_SECURITY_ISSUES_RETENTION_DAYS` | `30`    | Daily at 02:00   |
| `retention.component_changes_days`    | `COMPONENT_CHANGES_RETENTION_DAYS`    | `365`   | Sundays at 03:00 |

---

## Legacy Variables

These settings now live in the `app_settings` table (`./bin/vulnz setting:set`, or reference data). Each env var is read only when its app setting is missing, and logs a deprecation warning when it is used.

| App setting                               | Legacy env var                            | Default |
| ----------------------------------------- | ----------------------------------------- | ------- |
| `wordpress.current_version`               | `WORDPRESS_STABLE_VERSION`                | `6.7.1` |
| `php.minimum_version`                     | `PHP_MINIMUM_VERSION`                     | `8.0`   |
| `plugin.unmaintained_threshold_months`    | `PLUGIN_UNMAINTAINED_THRESHOLD_MONTHS`    | `6`     |
| `plugin.newly_published_threshold_months` | `PLUGIN_NEWLY_PUBLISHED_THRESHOLD_MONTHS` | `3`     |

`wordpress.current_version` is kept up to date automatically from wordpress.org, hourly at 5 minutes past.

`EXAMPLE_WP_COMPONENT_SLUG` and `EXAMPLE_WP_COMPONENT_VERSION` are returned, unchanged, to authenticated callers of `GET /api/config`. VULNZ itself does not use them.

`MARIADB_MINIMUM_VERSION`, `MYSQL_MINIMUM_VERSION`, `PHP_RECOMMENDED_VERSION` and `WPORG_THEME_INFO_ENDPOINT` appear in `.env.example` but are not read.

---

## Example Configurations

### Development

```plaintext
NODE_ENV=development
HTTP_LISTEN_PORT=3000
BASE_URL=http://localhost:3000

DB_HOST=localhost
DB_USER=vulnz_dev
DB_PASSWORD=dev_password
DB_NAME=vulnz_dev

PASSWORD_MIN_LENGTH=8
PASSWORD_MIN_ALPHA=1
PASSWORD_MIN_SYMBOLS=1
PASSWORD_MIN_NUMERIC=1
PASSWORD_MIN_UPPERCASE=1
PASSWORD_MIN_LOWERCASE=1

# Never email real customers from a dev host
SMTP_ENABLED=false

UNAUTH_SEARCH_LIMIT_PER_SECOND=10
CORS_ENABLED=true
CORS_ORIGIN=*

CRON_ENABLE=false
LOG_LEVEL=debug

REFERENCE_UPDATE_METHOD=file
REFERENCE_UPDATE_LOCATION=./data/reference.json
```

### Production

```plaintext
NODE_ENV=production
HTTP_LISTEN_PORT=3000
BASE_URL=https://vulnz.example.com

DB_HOST=db.example.com
DB_USER=vulnz_prod
DB_PASSWORD=strong-random-password-here
DB_NAME=vulnz

PASSWORD_MIN_LENGTH=12
PASSWORD_MIN_ALPHA=1
PASSWORD_MIN_SYMBOLS=1
PASSWORD_MIN_NUMERIC=1
PASSWORD_MIN_UPPERCASE=1
PASSWORD_MIN_LOWERCASE=1

UNAUTH_SEARCH_LIMIT_PER_SECOND=1

CORS_ENABLED=true
CORS_ORIGIN=https://example.com,https://app.example.com
CORS_CREDENTIALS=true

SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=vulnz@example.com
SMTP_PASS=smtp-password-here
SMTP_FROM="VULNZ <vulnz@example.com>"

REPORTING_HOUR=9
API_LOG_RETENTION_DAYS=7

CRON_ENABLE=true
LOG_LEVEL=info

REFERENCE_UPDATE_METHOD=url
REFERENCE_UPDATE_LOCATION=https://example.com/reference.json

VULNZ_NOTIFY_SECRET=output-of-openssl-rand-hex-32
```

---

## Security Best Practices

### File Permissions

Ensure `.env` is readable only by the application user:

```bash
chmod 600 .env
chown vulnz:vulnz .env
```

The server checks this at startup and refuses to start if the permissions are more open, unless `SKIP_STARTUP_FILEMODE_CHECKS=true`.

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

At startup VULNZ:

- **Refuses to start**, listing every problem, if `.env` is missing, a database or password policy setting is missing or malformed, `VULNZ_NOTIFY_SECRET` still has its placeholder, or `.env` has open permissions
- **Warns and uses the default** for an unrecognised `NODE_ENV`, `LOG_LEVEL`, `CRON_ENABLE`, `LIST_PAGE_SIZE`, `API_MAX_PAGE_SIZE` or `UNAUTH_SEARCH_LIMIT_PER_SECOND`
- **Warns** while `SMTP_ENABLED` is off, and when malware alerts are on without `MALWARE_ALERT_EMAIL`

Check the startup log for warnings.

---

## Troubleshooting

### Database Connection Errors

**Check:**

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` are correct
- Database server is running and listening on port 3306
- Database user has necessary privileges
- Firewall allows connection to the database port

### Email Not Sending

**Check:**

- `SMTP_ENABLED=true`
- Run `./bin/vulnz email:test you@example.com`, which reports the SMTP error code
- SMTP credentials are correct
- SMTP server allows connections from your IP
- Firewall allows outbound connections on the SMTP port
- `SMTP_FROM` domain matches the authenticated domain (some providers require this)

### No Weekly Reports

**Check:**

- `SMTP_ENABLED=true`, `CRON_ENABLE=true`, and `REPORTING_HOUR` is set
- The account's reporting weekday is today, and the hour (UTC) has passed

### CORS Issues

**Issue**: Browser blocks API requests

**Solution**:

1. Set `CORS_ENABLED=true`
2. Add the requesting origin to `CORS_ORIGIN`
3. If the client sends requests with `credentials: 'include'`, set `CORS_CREDENTIALS=true`

---

## PM2 Ecosystem File

Keep every application setting in `.env`, including `NODE_ENV` and `HTTP_LISTEN_PORT`. The ecosystem file should describe only how PM2 runs the process:

```javascript
module.exports = {
  apps: [
    {
      name: 'vulnz',
      script: 'src/index.js',
      instances: 4,
      exec_mode: 'cluster',
    },
  ],
};
```

A variable already present in the real environment always wins over `.env`, so a value left in the ecosystem file's `env` block silently overrides the one in `.env`. PM2 sets `NODE_APP_INSTANCE` for each cluster instance itself; only instance `0` schedules cron jobs, and an unclustered process counts as instance `0`.

---

## Next Steps

- Review [Installation Guide](installation.md)
- Explore [API Usage](api-usage.md)
