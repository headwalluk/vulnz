# Security Events

## Overview

Security events capture suspicious or notable activities on monitored websites. This includes failed login attempts, user enumeration probes, vulnerability scanning, and other security-relevant events.

## Goals

- Provide website administrators with visibility into security threats
- Track patterns and trends in attack vectors
- Include geographic context for security events (continent, country)
- Support flexible event types that can be added/modified without code changes
- Enable efficient grouping and reporting of events

## Data Ingestion

Security events are captured by the website hosting provider through their own log-file monitoring systems. Events are then POSTed to the VULNZ API.

**Future Enhancement**: The VULNZ WordPress plugin will be extended to capture failed login events directly from WordPress, but this is not part of the initial implementation.

## Data Model

### `security_event_types` Table

Defines the types of security events that can be recorded. This opinionated approach ensures:

- Consistent event categorization
- Easy grouping in reports
- Efficient storage (integer FK vs repeated strings)
- Ability to enable/disable event types

**Schema**:

```sql
CREATE TABLE security_event_types (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  severity ENUM('info', 'warning', 'critical') DEFAULT 'warning',
  enabled TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Initial Event Types**:

- `failed-login` - Failed Login Attempt
- `blocked-user-enum` - Blocked User Enumeration
- `xmlrpc-probe` - XML-RPC Probe Attempt
- `file-probe` - Suspicious File Access
- `plugin-enum` - Plugin Enumeration
- `theme-enum` - Theme Enumeration
- `brute-force` - Brute Force Attack Detected
- `sql-injection` - SQL Injection Attempt
- `xss-attempt` - XSS Attempt
- `command-injection` - Command Injection Attempt

### `security_events` Table

Records individual security events with geographic context and flexible details.

**Schema**:

```sql
CREATE TABLE security_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id INT UNSIGNED NOT NULL,
  event_type_id INT UNSIGNED NOT NULL,
  source_ip VARCHAR(45) NOT NULL,
  event_datetime TIMESTAMP NOT NULL,
  continent_code CHAR(2),
  country_code CHAR(2),
  details JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  FOREIGN KEY (event_type_id) REFERENCES security_event_types(id) ON DELETE RESTRICT,

  INDEX idx_website_datetime (website_id, event_datetime),
  INDEX idx_event_type (event_type_id),
  INDEX idx_source_ip (source_ip),
  INDEX idx_country (country_code)
);
```

**Details Field Examples**:

```json
// Failed login
{"username": "admin", "user_agent": "Mozilla/5.0..."}

// File probe
{"file_path": "/wp-admin/install.php", "method": "GET", "response_code": 403}

// Plugin enumeration
{"endpoint": "/wp-json/wp/v2/plugins", "user_agent": "..."}

// Brute force
{"username": "admin", "attempts_in_window": 25, "time_window_minutes": 5}
```

## Geographic Context

IP addresses are resolved to geographic locations using **MaxMind GeoIP2** (or similar service):

- `continent_code`: 2-character codes (AF, AS, EU, NA, OC, SA, AN)
- `country_code`: ISO 3166-1 alpha-2 country codes

This allows reporting like:

- "Top 10 countries for failed login attempts"
- "Security events by continent"
- Future: City-level or ASN-level grouping

## Data Retention

Security events contain potentially personally identifiable information (IP address + user agent + timestamp), so retention must be configurable and aggressive.

**Configuration**:

- `SECURITY_EVENTS_RETENTION_DAYS` (default: 30)
- Automated purge via cron job (similar to stale websites)
- Purge runs daily, removes events older than retention period

**Implementation**:

- `SecurityEvent.removeOldEvents()` static method
- Called by cron job in `src/lib/cron.js`

## API Endpoints

### POST /api/websites/:id/security-events

Record one or more security events for a website.

**Authentication**: API key or session with access to the website

**Request Body**:

```json
{
  "events": [
    {
      "event_type": "failed-login",
      "source_ip": "203.0.113.42",
      "event_datetime": "2025-12-06T14:30:00Z",
      "details": {
        "username": "admin",
        "user_agent": "Mozilla/5.0..."
      }
    }
  ]
}
```

**Response**: `201 Created` with event IDs

### GET /api/websites/:id/security-events

Retrieve security events for a website (future enhancement, low priority).

**Query Parameters**:

- `event_type` - Filter by event type slug
- `from_date` - Start date
- `to_date` - End date
- `limit` - Max results (default: 100)

## Reporting Integration

Security events will be included in the weekly vulnerability reports sent to website administrators.

**Report Sections**:

1. **Security Event Summary**
   - Total events by type
   - Events trend (up/down from previous period)
2. **Top Attack Sources**
   - Top 10 countries by event count
   - Events by continent
3. **Event Timeline**
   - Events per day over the reporting period
4. **Notable Patterns**
   - Repeated attacks from same IPs
   - Spike detection (3x normal volume)

## Configuration

New environment variables:

```bash
# Security Events
SECURITY_EVENTS_RETENTION_DAYS=30
GEOIP_DATABASE_PATH=/path/to/GeoLite2-City.mmdb
```

## Implementation Notes

- GeoIP lookups performed at event creation time (not stored separately)
- Event type management via admin UI (future enhancement)
- Bulk event insertion for performance (single transaction for multiple events)
- Consider partitioning `security_events` table by date for very high volumes
