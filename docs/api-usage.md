# API Usage

Using the VULNZ REST API for automation and integration.

---

## Overview

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

1. Log in to VULNZ web interface
2. Navigate to Dashboard
3. Scroll to "API Keys" section
4. Click "Create New API Key"
5. Enter a description (e.g., "Production Server Integration")
6. Copy the generated key (shown only once)

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
      "id": 123,
      "slug": "woocommerce",
      "name": "WooCommerce",
      "type": "wordpress-plugin",
      "latest_version": "8.5.0",
      "has_vulnerabilities": false
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10
}
```

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
PLUGINS=$(wp plugin list --format=json --path=/var/www/html | \
  jq '[.[] | {slug: .name, version: .version}]')

# Get themes
THEMES=$(wp theme list --format=json --path=/var/www/html | \
  jq '[.[] | select(.status == "active") | {slug: .name, version: .version}]')

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

Public search endpoint is rate-limited (configurable via `UNAUTH_SEARCH_LIMIT_PER_SECOND`):

**Default**: 1 request per second per IP

**Headers returned**:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `Retry-After`: Seconds to wait (if limit exceeded)

### Authenticated Requests

Requests with valid API keys have more generous limits (not currently enforced, but reserved for future use).

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
- `page`: Page number (1-indexed)
- `limit`: Items per page (default: 20, max: 100)

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
- Set up [Weekly Reports](weekly-reports.md)
- Configure [WordPress Plugin Integration](https://github.com/headwalluk/vulnz-wordpress-plugin)
- Review [Security Best Practices](configuration.md#security)
