# API Usage

Using the VULNZ REST API for automation and integration.

---

## Overview

> Asking fleet-wide questions from an AI agent? Start with [Fleet Queries for an AI Agent](agent-queries.md) — task-oriented recipes plus the pitfalls. This page is the endpoint reference.

VULNZ provides a comprehensive REST API for:

- Managing websites and components
- Tracking vulnerabilities
- Logging security events
- User and API key management

---

## Interactive Documentation

Access the interactive Swagger documentation at:

```
http://your-vulnz-server:3000/doc
```

Or download the OpenAPI specification:

```bash
curl http://your-vulnz-server:3000/openapi.json > vulnz-api.json
```

---

## Authentication

Most API endpoints require authentication via API key.

### Creating an API Key

API keys are issued from the CLI. There is no web interface — it was removed in v1.31.0.

```bash
# Create the account the key will belong to, if it does not exist yet
node bin/vulnz.js user:add integration@example.com 'SecurePass123!'

# Issue a key for it
node bin/vulnz.js key:generate integration@example.com
```

The key is printed once, at generation. Copy it then — it cannot be retrieved later, only revoked (`key:revoke`) and replaced.

A key carries the roles of the user it belongs to and nothing more, so scope it by choosing the right account: an ordinary `user` sees only their own websites, while an `administrator` sees every website in the database and can also create, block and delete users. Pass `--admin` to `user:add` only when the integration genuinely needs that reach.

See the [CLI Reference](cli.md#api-key-management-commands) for the full set of key commands.

### Using API Keys

Include your API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/api/websites
```

---

## Examples

### Searching for Components

Search for WordPress plugins and themes (no authentication required):

```bash
# Using curl
curl "http://localhost:3000/api/components/search?query=woocommerce&limit=10"

# Using HTTPie
http GET "localhost:3000/api/components/search?query=woocommerce&limit=10"

# Using JavaScript fetch
fetch('http://localhost:3000/api/components/search?query=woocommerce&limit=10')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Response:**

```json
{
  "components": [
    {
      "id": "123",
      "slug": "woocommerce",
      "component_type_slug": "wordpress-plugin",
      "component_type_title": "WordPress Plugin",
      "ecosystem_slug": "wordpress",
      "ecosystem_name": "WordPress",
      "title": "WooCommerce",
      "url": "https://wordpress.org/plugins/woocommerce/",
      "is_malware": false,
      "malware_summary": null,
      "malware_url": null,
      "releases": [
        {
          "version": "8.5.0",
          "vulnerabilities": [],
          "has_vulnerabilities": false
        }
      ]
    }
  ],
  "total": 1
}
```

Notes for clients:

- `id` is serialized as a **string** (the column is a `BIGINT`), so compare it as one.
- `total` is the count across all pages; the response does not echo `page` or `limit`.
- `releases` is sorted newest version first, and is empty for a component with no known releases.
- `is_malware` is the component-level malware verdict — see [Known malware](#known-malware) below.

### Known Malware

A component flagged as known malware carries `is_malware: true` and a one-line `malware_summary`. The verdict covers **every version** of that component, including versions ingested after it was flagged, so it appears on the component itself rather than on individual releases.

```bash
curl "https://api.vulnz.net/api/components/search?query=easypost&type=wordpress-plugin"
```

```json
{
  "components": [
    {
      "id": "36183",
      "slug": "easypost",
      "component_type_slug": "wordpress-plugin",
      "title": "easypost",
      "is_malware": true,
      "malware_summary": "Backdoor file dropper",
      "malware_url": "https://vulnz.net/malware/wordpress-plugin/easypost/",
      "releases": [
        { "version": "2.4.1", "vulnerabilities": [], "has_vulnerabilities": false },
        { "version": "1.0.0", "vulnerabilities": [], "has_vulnerabilities": false }
      ]
    }
  ],
  "total": 1
}
```

`is_malware` is also returned by `GET /api/components/{type}/{slug}`, `GET /api/components/{id}`, and `GET /api/components/{type}/{slug}/{version}`.

### Malware on a Website

`GET /api/websites/{domain}` reports `malware_count` alongside `vulnerability_count`, and marks the offending components inline:

```json
{
  "title": "Headwall Demo & Dev",
  "vulnerability_count": 0,
  "malware_count": 1,
  "wordpress-plugins": [
    {
      "slug": "easypost",
      "version": "2.4.1",
      "has_vulnerabilities": false,
      "vulnerabilities": [],
      "is_malware": true,
      "malware_summary": "Backdoor file dropper",
      "malware_url": "https://vulnz.net/malware/wordpress-plugin/easypost/",
      "malware_first_detected_at": "2026-08-13T10:19:33.000Z"
    }
  ]
}
```

- `malware_count` counts flagged plugins and themes. It is independent of `vulnerability_count` — a site can have malware and zero vulnerabilities, as above.
- `malware_url` is null when no write-up has been recorded.
- `malware_first_detected_at` is null until the site has synced since the component was flagged, because detections are stamped by the ingest path rather than by reads.
- `has_vulnerabilities: false` on a malware component is correct and deliberate: no vulnerability has been recorded against that release. Act on `is_malware`.

`has_vulnerabilities` and `is_malware` are **independent signals**. A flagged component reports `has_vulnerabilities: false` unless an actual vulnerability has been recorded against that release, because "this has a known CVE" and "this is malicious software" are different statements calling for different responses. Branch on `is_malware`.

> **Changed in v1.36.0.** Between v1.34.0 and v1.35.x a flagged component also forced `has_vulnerabilities: true` on all of its releases, as a temporary way to make existing clients react without a code change. That coupling has been removed. If you were relying on it, switch to `is_malware`.

`malware_url` links to a write-up of what the malware does, and is null when none has been recorded.

The flag is set by an administrator via the CLI (`vulnz component:malware:add`). There is no API write path for it, and no API key of any role can set or clear it.

### Finding Affected Websites

`GET /api/websites/malware` lists every website carrying one or more known-malware components, and which components those are. Administrators see all websites; other users see only their own.

```bash
curl "https://api.vulnz.net/api/websites/malware" -H "X-Api-Key: ${VULNZ_API_KEY}"
```

```json
{
  "websites": [
    {
      "domain": "example.com",
      "title": "Example Site",
      "user_id": 1,
      "is_dev": false,
      "malware_components": [
        {
          "slug": "easypost",
          "type": "wordpress-plugin",
          "version": "2.4.1",
          "summary": "Backdoor file dropper",
          "first_detected_at": "2026-08-13T10:41:00.000Z"
        }
      ]
    }
  ],
  "total_websites": 1,
  "total_components": 2
}
```

An empty `websites` array means nothing is affected — that is the healthy response.

The result is computed live from the component flags, so flagging a component makes every site already carrying it appear immediately, with no re-sync needed from the host. `first_detected_at` is null until a site has synced since the component was flagged, because detection timestamps are recorded by the ingest path rather than by this read-only endpoint.

This is the polling counterpart to the immediate email alert below: if an alert is missed, this endpoint still reports the site.

### Immediate Malware Alerts

When a website sync (`PUT /api/websites/{domain}`) reports a component flagged as known malware, VULNZ emails an alert straight away — it does not wait for the weekly report.

Configure it in `.env`:

```bash
MALWARE_ALERT_ENABLED=true
MALWARE_ALERT_EMAIL='security@example.com'
```

Both default to off, so the feature ships inert.

**Alerts are deduplicated per (website, component).** The first sighting emails; later syncs stay quiet. This matters because hosts sync continuously — without it, the same alert would repeat until it was filtered away as noise, which is exactly the email that must not be missed. If a component is cleaned off a site and later reappears, that counts as a fresh infection and alerts again.

If the send fails, the alert is retried on the site's next sync rather than being silently dropped, and a mail failure never fails the host's update. Detections are recorded whether or not alerting is enabled, so `GET /api/websites/malware` is accurate either way.

The recipient is a single operator address for now. Routing alerts to each website's own point of contact needs per-site contact data that does not exist yet.

### Plugins Withdrawn from wordpress.org

Every component read path reports what wordpress.org currently says about the slug. This is a **separate signal from `is_malware`**: "the directory withdrew this" and "we believe this is malicious" are different statements, and a caller should be able to act on either without inferring it from the other.

```bash
curl "https://api.vulnz.net/api/components/wordpress-plugin/portable-phpmyadmin" \
  -H "X-Api-Key: ${VULNZ_API_KEY}"
```

```json
{
  "slug": "portable-phpmyadmin",
  "title": "Portable phpMyAdmin",
  "is_malware": false,
  "wporg_status": "closed",
  "wporg_closure_reason": "security-issue",
  "wporg_closed_at": "2017-11-20"
}
```

`wporg_status` is one of:

| Value       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `available` | Published on wordpress.org right now                                    |
| `closed`    | Was published and has since been **withdrawn** by the directory         |
| `absent`    | The directory has never listed this slug — premium, in-house, or a fake |
| `unknown`   | Not resolved yet                                                        |

**Why `closed` matters.** wordpress.org answers HTTP 404 for both a slug it has never listed and one it has pulled, so the two look identical unless the response body is read. Plugins are frequently withdrawn _because_ of an unpatched vulnerability, and a site still running one is running something the directory removed — often with no CVE and no Wordfence record, so it appears nowhere else in this API. Check `wporg_closure_reason` for wordpress.org's own reason: `security-issue`, `author-request`, `guideline-violation`, `licensing-trademark-violation`, and others.

That vocabulary belongs to wordpress.org and can grow at any time. Treat an unrecognised reason as valid rather than as an error — VULNZ records new reasons verbatim instead of discarding them.

`wporg_closure_is_security_concern` is the classification of that reason, and it is **tri-state**:

| Value   | Meaning                                                          |
| ------- | ---------------------------------------------------------------- |
| `true`  | wordpress.org withdrew it over a security issue                  |
| `false` | Withdrawn for another reason, assessed as not a security concern |
| `null`  | The reason exists but nobody has classified it                   |

`null` is **not** an all-clear. Prefer this field to string-matching `wporg_closure_reason`, which misses both unclassified reasons and any new reason wordpress.org introduces.

`wporg_closed_at` is a plain `YYYY-MM-DD` date with no time component. A `null` on any of these fields means the component is not closed (or has not been resolved yet).

#### Enumerating withdrawn components

The catalogue runs to tens of thousands of rows, so `GET /api/components` is filterable:

```bash
# Every withdrawn component
curl "https://api.vulnz.net/api/components?wporg_status=closed&limit=200" \
  -H "X-Api-Key: ${VULNZ_API_KEY}"

# Only those wordpress.org attributes to a security issue
curl "https://api.vulnz.net/api/components?wporg_status=closed&wporg_closure_reason=security-issue" \
  -H "X-Api-Key: ${VULNZ_API_KEY}"
```

`wporg_status` accepts `available`, `closed`, `absent` or `unknown`; `component_type` filters by type. An unknown value for either is a `400` rather than an empty list.

#### Which of your sites are affected

```bash
curl "https://api.vulnz.net/api/websites?component_wporg_status=closed" \
  -H "X-Api-Key: ${VULNZ_API_KEY}"
```

Every site carrying any withdrawn component, in one call — no need to know a slug first. Composes with `only_vulnerable`, `sort` and `component_type`, and respects ownership like every other website query.

### Adding a Website

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"domain": "example.com", "title": "My WordPress Site"}' \
  http://localhost:3000/api/websites
```

**Response:**

```json
{
  "id": 1,
  "domain": "example.com",
  "title": "My WordPress Site",
  "user_id": 1,
  "is_ssl": true,
  "is_dev": false,
  "created_at": "2026-01-02T10:00:00.000Z"
}
```

### Updating Website Versions

Track WordPress core, PHP, and database versions:

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "wordpress_version": "6.4.2",
    "php_version": "8.2.0",
    "db_server_type": "MariaDB",
    "db_server_version": "10.11.0"
  }' \
  http://localhost:3000/api/websites/example.com
```

### Adding Components to Website

Update the list of plugins/themes installed:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "wordpress-plugins": [
      {"slug": "woocommerce", "version": "8.5.0"},
      {"slug": "jetpack", "version": "12.9.0"}
    ],
    "wordpress-themes": [
      {"slug": "twentytwentyfour", "version": "1.0"}
    ]
  }' \
  http://localhost:3000/api/websites/example.com/components
```

### Reporting a Vulnerability

Add vulnerability information for a specific component version:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "urls": [
      "https://wpscan.com/vulnerability/12345",
      "https://www.wordfence.com/threat-intel/vulnerabilities/id/abcd-1234"
    ]
  }' \
  http://localhost:3000/api/components/wordpress-plugin/jetpack/12.8.0
```

### Logging Security Events

Report security incidents (failed logins, attacks, etc.):

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "events": [
      {
        "event_type": "failed-login",
        "event_datetime": "2026-01-02T15:30:00Z",
        "source_ip": "192.168.1.100",
        "username": "admin",
        "user_agent": "Mozilla/5.0..."
      },
      {
        "event_type": "firewall-block",
        "event_datetime": "2026-01-02T15:31:00Z",
        "source_ip": "192.168.1.101",
        "meta": {"reason": "SQL injection attempt"}
      }
    ]
  }' \
  http://localhost:3000/api/websites/example.com/security-events
```

**Response:**

```json
{
  "created": 2,
  "duplicates": 0,
  "errors": 0
}
```

### Listing Supported Ecosystems

Discover which component ecosystems are available (requires authentication):

```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/ecosystems
```

**Response:**

```json
[
  {
    "id": 1,
    "slug": "wordpress",
    "name": "WordPress",
    "description": null,
    "active": true
  },
  {
    "id": 2,
    "slug": "npm",
    "name": "npm",
    "description": null,
    "active": true
  }
]
```

### Adding a Node.js Application

Track npm packages for a Node.js app using the generic `components` array and `ecosystem` field:

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "ecosystem": "npm",
    "platform": {
      "name": "Node.js",
      "version": "20.11.0",
      "packageManager": "npm"
    },
    "components": [
      { "slug": "express", "version": "4.18.2", "type": "npm-package" },
      { "slug": "lodash", "version": "4.17.21", "type": "npm-package" }
    ]
  }' \
  http://localhost:3000/api/websites/myapp.example.com
```

This creates the website if it doesn't exist, or updates it if it does.

### Adding WordPress Components (Modern Format)

The generic `components` array also works for WordPress:

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "ecosystem": "wordpress",
    "platform": {
      "name": "WordPress",
      "version": "6.4.2",
      "phpVersion": "8.2.0",
      "databaseEngine": "MariaDB",
      "databaseVersion": "10.11.0"
    },
    "components": [
      { "slug": "woocommerce", "version": "8.5.0", "type": "wordpress-plugin" },
      { "slug": "twentytwentyfour", "version": "1.0", "type": "wordpress-theme" }
    ]
  }' \
  http://localhost:3000/api/websites/example.com
```

---

## Common Patterns

### WordPress Plugin Integration

Typical workflow for a WordPress security plugin:

```php
<?php
// 1. Detect WordPress version, plugins, themes
$wordpress_version = get_bloginfo('version');
$plugins = get_plugins();
$theme = wp_get_theme();

// 2. Send to VULNZ
$data = [
    'wordpress_version' => $wordpress_version,
    'php_version' => PHP_VERSION,
    'db_server_type' => 'MySQL',
    'db_server_version' => $wpdb->db_version()
];

$response = wp_remote_put(
    'https://vulnz.example.com/api/websites/' . $_SERVER['HTTP_HOST'],
    [
        'headers' => ['X-API-Key' => get_option('vulnz_api_key')],
        'body' => json_encode($data)
    ]
);

// 3. Update component list
$components = [
    'wordpress-plugins' => [],
    'wordpress-themes' => []
];

foreach ($plugins as $plugin_file => $plugin_data) {
    $components['wordpress-plugins'][] = [
        'slug' => dirname($plugin_file),
        'version' => $plugin_data['Version']
    ];
}

$components['wordpress-themes'][] = [
    'slug' => $theme->get_stylesheet(),
    'version' => $theme->get('Version')
];

wp_remote_post(
    'https://vulnz.example.com/api/websites/' . $_SERVER['HTTP_HOST'] . '/components',
    [
        'headers' => ['X-API-Key' => get_option('vulnz_api_key')],
        'body' => json_encode($components)
    ]
);

// 4. Log security events
function log_failed_login($username, $ip) {
    $event = [
        'events' => [[
            'event_type' => 'failed-login',
            'event_datetime' => gmdate('Y-m-d\TH:i:s\Z'),
            'source_ip' => $ip,
            'username' => $username
        ]]
    ];

    wp_remote_post(
        'https://vulnz.example.com/api/websites/' . $_SERVER['HTTP_HOST'] . '/security-events',
        [
            'headers' => ['X-API-Key' => get_option('vulnz_api_key')],
            'body' => json_encode($event)
        ]
    );
}
```

### Node.js Application Integration (vulnz-sensor)

The easiest way to track npm dependencies is with **vulnz-sensor** — a zero-dependency CLI tool included in this repository:

```bash
# Install in your Node.js project
npm install --save-dev vulnz-sensor

# Report dependencies from your project root
npx vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY

# Using environment variables (recommended for CI/CD)
VULNZ_API_URL=https://vulnz.example.com \
  VULNZ_API_KEY=YOUR_API_KEY \
  VULNZ_DOMAIN=myapp.example.com \
  npx vulnz-sensor

# Dry-run to preview the payload without sending
npx vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY \
  --dry-run
```

**GitHub Actions example:**

```yaml
- name: Report dependencies to Vulnz
  run: npx vulnz-sensor ${{ vars.VULNZ_DOMAIN }}
  env:
    VULNZ_API_URL: ${{ vars.VULNZ_API_URL }}
    VULNZ_API_KEY: ${{ secrets.VULNZ_API_KEY }}
```

vulnz-sensor reads exact installed versions from `node_modules` (not the semver range in `package.json`) to ensure VULNZ tracks what is actually running. See [packages/vulnz-sensor/README.md](../packages/vulnz-sensor/README.md) for all options.

### Scheduled Sync Script

Daily sync from cron:

```bash
#!/bin/bash

API_KEY="your-api-key"
DOMAIN="example.com"
API_BASE="https://vulnz.example.com/api"

# Get current WordPress version
WP_VERSION=$(wp core version --path=/var/www/html)

# Get PHP version
PHP_VERSION=$(php -r 'echo PHP_VERSION;')

# Update versions
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"wordpress_version\": \"$WP_VERSION\", \"php_version\": \"$PHP_VERSION\"}" \
  "$API_BASE/websites/$DOMAIN"

# Get plugins (WP-CLI)
PLUGINS=$(wp plugin list --format=json --path=/var/www/html \
  | jq '[.[] | {slug: .name, version: .version}]')

# Get themes
THEMES=$(wp theme list --format=json --path=/var/www/html \
  | jq '[.[] | select(.status == "active") | {slug: .name, version: .version}]')

# Update components
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"wordpress-plugins\": $PLUGINS, \"wordpress-themes\": $THEMES}" \
  "$API_BASE/websites/$DOMAIN/components"
```

---

## Rate Limiting

### Unauthenticated Requests

The public search endpoint is rate-limited per client IP. Two settings control it:

| Setting                          | Default | Meaning                                                          |
| -------------------------------- | ------- | ---------------------------------------------------------------- |
| `UNAUTH_SEARCH_LIMIT_PER_SECOND` | `1`     | Sustained rate, averaged over the window. `0` disables limiting. |
| `UNAUTH_SEARCH_WINDOW_SECONDS`   | `10`    | The window the rate is counted over.                             |

The budget is `limit × window` requests per window — 10 back-to-back requests at the defaults. Counting over a window rather than a single second is what makes search-as-you-type workable: typing a slug produces a burst of requests and then silence, and a one-second window rejected that even when the average rate was well within budget.

**Headers returned** (`RateLimit` draft-7 format):

- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- `Retry-After` when the limit is exceeded

**When the limit is hit** the response is `429` with a JSON body:

```json
{
  "error": "Too many requests",
  "message": "Search is rate limited for unauthenticated callers. Slow down, or use an API key.",
  "retry_after_seconds": 7
}
```

Note that other error responses from the search endpoint are **plain text**, not JSON — a missing query returns `400 Search query is required.` So check `response.ok` before calling `response.json()`.

### Authenticated Requests

Requests with a valid API key are **not** subject to the search limit — they are identified, logged and revocable, so the anonymous IP budget does not apply. If a browser-side search box is hitting 429s, sending an API key is an alternative to raising the anonymous limit, though it does mean exposing that key to the browser.

---

## Error Handling

### HTTP Status Codes

- **200 OK**: Success
- **201 Created**: Resource created
- **204 No Content**: Success with no response body
- **400 Bad Request**: Invalid input
- **401 Unauthorized**: Missing or invalid API key
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource doesn't exist
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Server error

### Error Responses

```json
{
  "error": "Website not found"
}
```

Or plain text:

```
Domain and title are required
```

---

## Pagination

List endpoints support pagination:

```bash
curl "http://localhost:3000/api/websites?page=2&limit=20" \
  -H "X-API-Key: your-api-key"
```

**Parameters**:

- `page`: Page number (1-indexed). Must be a positive integer.
- `limit`: Items per page. Must be a positive integer, and no greater than `API_MAX_PAGE_SIZE` (default **200**). Defaults to **10** on `/api/websites` and to `LIST_PAGE_SIZE` on `/api/components`.

An out-of-range or non-numeric value returns `400` with `error` and `message`, rather than being clamped or falling back to the default. A response that quietly used a different page size than the one requested is indistinguishable from a correct one.

> **Corrected in v1.39.2.** This section previously said "default: 20, max: 100". Both were wrong — the default was 10 and there was no maximum at all.

**Response**:

```json
{
  "websites": [...],
  "total": 150,
  "page": 2,
  "limit": 20,
  "pages": 8
}
```

---

## Filtering & Search

### Search Components

```bash
# By name or slug
curl "http://localhost:3000/api/components/search?query=woocommerce"

# Filter by type
curl "http://localhost:3000/api/components/search?query=jetpack&type=wordpress-plugin"
```

### List Websites

```bash
# Search by domain
curl "http://localhost:3000/api/websites?q=example" \
  -H "X-API-Key: your-api-key"

# Only vulnerable websites
curl "http://localhost:3000/api/websites?only_vulnerable=true" \
  -H "X-API-Key: your-api-key"
```

**Which sites run a given component** — the blast-radius question. `component_slug` on its own matches every version; add `component_version` to pin one release, or `component_type` where a plugin and a theme share a slug.

```bash
# Every site running this plugin, any version
curl "http://localhost:3000/api/websites?component_slug=foobar" \
  -H "X-API-Key: your-api-key"

# Only sites on one specific release
curl "http://localhost:3000/api/websites?component_slug=foobar&component_version=1.2.3&component_type=wordpress-plugin" \
  -H "X-API-Key: your-api-key"
```

**Worst-affected first.** `sort` accepts `newest` (default), `vulnerabilities`, or `malware`. Ranking happens in the database over the whole matching set, so page 1 really is the worst affected — not merely the first page annotated with counts. Ties break on the other count, then on recency, so paging is stable.

```bash
# The ten most vulnerable sites
curl "http://localhost:3000/api/websites?sort=vulnerabilities&limit=10" \
  -H "X-API-Key: your-api-key"
```

An unrecognised `sort` returns `400` rather than quietly falling back to the default — a caller asking for the worst-affected sites and receiving the newest ones has no way to detect the substitution.

**Which sites run something wordpress.org withdrew** — `component_wporg_status` filters on the directory status of the components a site carries, and works without `component_slug`:

```bash
curl "http://localhost:3000/api/websites?component_wporg_status=closed" \
  -H "X-API-Key: your-api-key"
```

All of these compose, and all respect ownership: an administrator sees every website, everyone else sees only their own.

```bash
# Sites running a specific plugin that also have a known vulnerability,
# worst first
curl "http://localhost:3000/api/websites?component_slug=foobar&only_vulnerable=true&sort=vulnerabilities" \
  -H "X-API-Key: your-api-key"
```

**The filter parameters are validated.** A modifier without the parameter it modifies is a `400`, not a quietly wider result:

- `component_version` requires `component_slug` — a bare version number is meaningless across components
- `component_type` requires `component_slug` or `component_wporg_status`, and must be a real type slug
- an unknown `component_type` or `component_wporg_status` is rejected rather than returning zero sites

Returning zero sites for a typo would read as "nothing affected", which is the wrong direction to fail in for a security query.

> **Changed in v1.39.2.** These previously returned `200`. `?component_version=8.5.0` on its own returned the entire fleet, which reads as "every site runs 8.5.0".

---

## Bulk Operations

### Bulk Security Events

Submit multiple events in one request:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "events": [
      {
        "event_type": "failed-login",
        "event_datetime": "2026-01-02T15:30:00Z",
        "source_ip": "192.168.1.100",
        "username": "admin"
      },
      {
        "event_type": "failed-login",
        "event_datetime": "2026-01-02T15:31:00Z",
        "source_ip": "192.168.1.100",
        "username": "admin"
      }
    ]
  }' \
  http://localhost:3000/api/websites/example.com/security-events
```

**Note**: Events are deduplicated automatically based on website, event type, IP, and timestamp.

---

## Best Practices

1. **Store API keys securely**: Never commit to version control
2. **Use HTTPS**: Always use HTTPS in production
3. **Handle errors gracefully**: Check response status codes
4. **Respect rate limits**: Implement backoff for 429 responses
5. **Batch requests**: Use bulk endpoints when available
6. **Validate input**: Sanitize data before sending
7. **Monitor API usage**: Check API logs periodically

---

## Tools & Libraries

### Command Line

- **curl**: Universal HTTP client
- **HTTPie**: Human-friendly HTTP client
- **jq**: JSON processor

### Programming Languages

- **JavaScript/Node.js**: `node-fetch`, `axios`
- **PHP**: `wp_remote_*`, `curl`
- **Python**: `requests`
- **Ruby**: `httparty`, `rest-client`
- **Go**: `net/http`

---

## Next Steps

- Explore [Interactive API Docs](http://localhost:3000/doc)
- Configure [WordPress Plugin Integration](https://github.com/headwalluk/vulnz-wordpress-plugin)
- Track npm packages with [vulnz-sensor](../packages/vulnz-sensor/README.md)
- Review [Security Best Practices](configuration.md#security)
