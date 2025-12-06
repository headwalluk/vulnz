# App Settings

## Overview

A simple key-value configuration system for runtime parameters, version thresholds, and operational settings. This replaces hardcoded values and environment variables for non-sensitive configuration data.

## Use Cases

- Software version thresholds (WordPress current, PHP minimum/recommended, etc.)
- Data retention periods (security events, file issues, component changes)
- Operational limits (batch sizes, rate limits, timeouts)
- Feature flags and toggles
- Default values for user preferences

## Design Principles

1. **Simple Key-Value Store**: Dot-namespaced keys with typed values
2. **Non-Sensitive Data Only**: No credentials, API keys, or secrets
3. **Read Access for All**: Any authenticated user can read settings
4. **Admin-Only Writes**: Only administrators can create/update/delete settings
5. **Type Safety**: Store values with their data type for proper casting
6. **Seeded Defaults**: Sensible defaults loaded on first run

## Schema

### Table: `app_settings`

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(255) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  value_type ENUM('string', 'integer', 'float', 'boolean') DEFAULT 'string',
  description TEXT,
  category VARCHAR(100),
  is_system TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category),
  INDEX idx_is_system (is_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**Fields:**
- `setting_key`: Dot-namespaced key (e.g., `wordpress.current_version`)
- `setting_value`: String representation of the value
- `value_type`: Data type for proper casting when retrieved
- `description`: Human-readable description of what this setting controls
- `category`: Logical grouping (versions, retention, limits, features)
- `is_system`: Flag for core system settings that shouldn't be deleted
- `created_at`: When the setting was first created
- `updated_at`: When the setting was last modified

## Type System Design

We store all values as TEXT in the database but include a `value_type` field to support proper type casting when retrieving values. This approach provides type safety while maintaining simplicity in storage.

### Supported Types

**string**: Text values, version numbers (e.g., `"8.2"`, `"6.9"`)
**integer**: Whole numbers (e.g., retention days, batch sizes)
**float**: Decimal numbers (e.g., rate limits, percentages)
**boolean**: True/false flags stored as `"true"`/`"false"` strings

### Type Casting

The model automatically casts retrieved values based on their `value_type`:
- `integer` → `parseInt(value, 10)`
- `float` → `parseFloat(value)`
- `boolean` → `value === 'true'`
- `string` → no casting (raw string)

## Namespace Conventions

### Recommended Namespaces:

- `wordpress.*` - WordPress version and configuration
- `php.*` - PHP version thresholds
- `database.*` - Database version requirements
- `retention.*` - Data retention policies
- `batch.*` - Batch processing sizes
- `rate.*` - Rate limiting configuration
- `feature.*` - Feature flags
- `report.*` - Reporting configuration
- `scan.*` - Security scanning parameters

### Examples:

```
wordpress.current_version='6.9'
wordpress.minimum_version='6.4'
php.minimum_version='8.1'
php.recommended_version='8.3'
database.mariadb_minimum='10.6.0'
database.mysql_minimum='8.0.0'
retention.security_events=30
retention.file_issues=30
retention.component_changes=365
batch.wporg_sync_size=10
batch.reporting_size=5
rate.unauth_api_per_second=1
feature.auto_delete_websites=false
report.include_zero_vulnerabilities=false
scan.max_file_size_mb=10
```

## Model API

### AppSetting Model (`src/models/appSetting.js`)

```javascript
// Get a single setting with type casting
await AppSetting.get(key, defaultValue = null)
// Returns: casted value or defaultValue if not found

// Get multiple settings by pattern
await AppSetting.getByPattern(pattern)
// Example: AppSetting.getByPattern('retention.*')
// Returns: array of {key, value, type, description}

// Get settings by category
await AppSetting.getByCategory(category)
// Returns: array of settings in that category

// Get all settings
await AppSetting.getAll()
// Returns: array of all settings

// Set a setting (admin only in route)
await AppSetting.set(key, value, type, description = null, category = null)
// Upserts the setting with proper type

// Delete a setting (admin only in route)
await AppSetting.delete(key)
// Only deletes if is_system = 0

// Bulk set (for seeding)
await AppSetting.bulkSet(settings)
// settings: array of {key, value, type, description, category, is_system}
```

### Type Casting

The model should automatically cast values when retrieved:

```javascript
const maxDays = await AppSetting.get('retention.security_events'); 
// Returns: 30 (integer)

const isEnabled = await AppSetting.get('feature.auto_delete_websites');
// Returns: false (boolean)

const version = await AppSetting.get('php.minimum_version');
// Returns: "8.1" (string)

const rateLimit = await AppSetting.get('rate.unauth_api_per_second');
// Returns: 1.5 (float)
```

## REST API

### GET /api/settings

Get all settings (or filter by pattern/category)

**Authentication**: Any authenticated user

**Query Parameters:**
- `pattern` (optional): Glob pattern to filter keys (e.g., `retention.*`)
- `category` (optional): Filter by category

**Response:**
```json
{
  "settings": [
    {
      "key": "wordpress.current_version",
      "value": "6.9",
      "type": "string",
      "description": "Current stable WordPress version",
      "category": "versions"
    }
  ]
}
```

### GET /api/settings/:key

Get a single setting by key

**Authentication**: Any authenticated user

**Response:**
```json
{
  "key": "php.minimum_version",
  "value": "8.1",
  "type": "string",
  "description": "Minimum acceptable PHP version",
  "category": "versions"
}
```

### PUT /api/settings/:key

Create or update a setting

**Authentication**: Administrator only

**Request Body:**
```json
{
  "value": "8.2",
  "type": "string",
  "description": "Minimum acceptable PHP version",
  "category": "versions"
}
```

**Response:**
```json
{
  "success": true,
  "key": "php.minimum_version",
  "value": "8.2"
}
```

### DELETE /api/settings/:key

Delete a setting (if not system-protected)

**Authentication**: Administrator only

**Response:**
```json
{
  "success": true,
  "message": "Setting deleted"
}
```

## Seeded Defaults

Settings that should be created on first run (using INSERT IGNORE):

```javascript
const defaultSettings = [
  // Version Thresholds
  { key: 'wordpress.current_version', value: '6.7.1', type: 'string', 
    description: 'Current stable WordPress version', category: 'versions', is_system: 1 },
  { key: 'wordpress.minimum_version', value: '6.4', type: 'string',
    description: 'Minimum acceptable WordPress version', category: 'versions', is_system: 1 },
  { key: 'php.minimum_version', value: '8.1', type: 'string',
    description: 'Minimum acceptable PHP version', category: 'versions', is_system: 1 },
  { key: 'php.recommended_version', value: '8.3', type: 'string',
    description: 'Recommended PHP version', category: 'versions', is_system: 1 },
  { key: 'database.mariadb_minimum', value: '10.6.0', type: 'string',
    description: 'Minimum MariaDB version', category: 'versions', is_system: 1 },
  { key: 'database.mysql_minimum', value: '8.0.0', type: 'string',
    description: 'Minimum MySQL version', category: 'versions', is_system: 1 },
  
  // Data Retention
  { key: 'retention.security_events', value: '30', type: 'integer',
    description: 'Security events retention in days', category: 'retention', is_system: 1 },
  { key: 'retention.file_issues', value: '30', type: 'integer',
    description: 'File security issues retention in days', category: 'retention', is_system: 1 },
  { key: 'retention.component_changes', value: '365', type: 'integer',
    description: 'Component changes retention in days', category: 'retention', is_system: 1 },
  { key: 'retention.api_logs', value: '7', type: 'integer',
    description: 'API log retention in days', category: 'retention', is_system: 1 },
  
  // Batch Sizes
  { key: 'batch.wporg_sync', value: '10', type: 'integer',
    description: 'WordPress.org sync batch size', category: 'batch', is_system: 1 },
  { key: 'batch.reporting', value: '5', type: 'integer',
    description: 'Email reporting batch size', category: 'batch', is_system: 1 },
  
  // Feature Flags
  { key: 'feature.auto_delete_websites', value: 'false', type: 'boolean',
    description: 'Enable automatic stale website deletion', category: 'features', is_system: 1 },
  { key: 'feature.geoip_enabled', value: 'true', type: 'boolean',
    description: 'Enable GeoIP lookups for security events', category: 'features', is_system: 0 },
];
```

## Migration from Environment Variables

### Phase 1: Add App Settings (v1.11.0)
- Create app_settings table
- Create AppSetting model
- Create API routes
- Seed default settings
- Keep existing environment variable fallbacks

### Phase 2: Migrate Codebase (v1.12.0)
- Update all code to use AppSetting.get() instead of process.env
- Maintain backwards compatibility with env vars as fallback
- Update documentation

### Phase 3: Deprecate Environment Variables (v2.0.0)
- Remove environment variable fallbacks
- Remove settings from env.sample
- Breaking change documented in CHANGELOG

## Code Examples

### Using Settings in Reporting

**Before:**
```javascript
const retentionDays = parseInt(process.env.SECURITY_EVENTS_RETENTION_DAYS, 10) || 30;
const wpVersion = process.env.WORDPRESS_STABLE_VERSION || '6.7.1';
```

**After:**
```javascript
const retentionDays = await AppSetting.get('retention.security_events', 30);
const wpVersion = await AppSetting.get('wordpress.current_version', '6.7.1');
```

### Updating Settings via API

```bash
# Update PHP minimum version
http PUT http://localhost:3001/api/settings/php.minimum_version \
  X-API-Key:$ADMIN_API_KEY \
  value="8.2" \
  type="string" \
  description="Minimum acceptable PHP version" \
  category="versions"

# Get all retention settings
http GET http://localhost:3001/api/settings?pattern=retention.* \
  X-API-Key:$API_KEY
```

## Security Considerations

1. **No Sensitive Data**: Never store credentials, API keys, or secrets
2. **Admin-Only Writes**: Enforce administrator role check in routes
3. **System Protection**: System settings (is_system=1) cannot be deleted
4. **Validation**: Validate value types before storing
5. **Audit Trail**: updated_at tracks when settings change
6. **Read Access**: All authenticated users can read settings safely

## Benefits

1. **No App Restarts**: Update configuration without redeploying
2. **Version Control**: Settings changes tracked with updated_at
3. **Type Safety**: Proper casting prevents type coercion bugs
4. **Centralized**: One place to manage all runtime configuration
5. **API-First**: Can be integrated with future admin UI
6. **Self-Documenting**: Description field explains each setting
7. **Categorized**: Easy to find related settings
8. **Protected**: System settings can't be accidentally deleted

## Future Enhancements

1. **Admin UI**: Web interface for managing settings
2. **Setting History**: Audit log of all setting changes
3. **Validation Rules**: Schema validation for setting values
4. **Setting Groups**: Bulk update related settings
5. **Import/Export**: Backup and restore configuration
6. **Environment Overrides**: Allow env vars to override for specific deployments
7. **Setting Dependencies**: Mark settings that depend on others
8. **UI Hints**: Field types and validation rules for future admin interface

## Implementation Checklist

### Database
- [ ] Create migration for app_settings table
- [ ] Add indexes for performance
- [ ] Seed default settings using INSERT IGNORE

### Model
- [ ] Create AppSetting model with type casting
- [ ] Implement get/set/delete methods
- [ ] Implement pattern and category filtering
- [ ] Add value type validation

### Routes
- [ ] Create GET /api/settings (with filters)
- [ ] Create GET /api/settings/:key
- [ ] Create PUT /api/settings/:key (admin only)
- [ ] Create DELETE /api/settings/:key (admin only)
- [ ] Add authentication middleware
- [ ] Add administrator role check for writes

### Testing
- [ ] Test type casting (string/int/float/bool)
- [ ] Test pattern filtering
- [ ] Test admin-only enforcement
- [ ] Test system setting protection
- [ ] Test INSERT IGNORE for seeding

### Documentation
- [ ] Update API documentation
- [ ] Add usage examples
- [ ] Document migration path from env vars
- [ ] Update deployment guide

## Reference Data Updates

The system automatically fetches and updates version thresholds and other reference settings from a trusted source twice daily (11am and 11pm GMT, aligned with WordPress release schedules).

### Configuration

```bash
# Method: url | file | disabled
REFERENCE_UPDATE_METHOD=url
REFERENCE_UPDATE_LOCATION=https://vulnz.net/reference.json
```

### Reference Data Format

```json
{
  "app_settings": {
    "wordpress.current_version": "6.7.1",
    "wordpress.minimum_version": "6.4",
    "php.minimum_version": "8.1",
    "php.recommended_version": "8.3",
    "php.eol_version": "7.4",
    "database.mysql_minimum_version": "8.0",
    "database.mariadb_minimum_version": "10.5"
  }
}
```

### Behavior

- **Validation**: Version strings are validated using semver pattern (`\d+\.\d+(\.\d+)?`)
- **Unknown Settings**: Settings in reference data that don't exist in the database are logged but not created
- **Type Safety**: Setting types are preserved from existing database schema
- **Graceful Failure**: Network timeouts or invalid data won't crash the application
- **Logging**: Updates are logged to console for monitoring

### Future Enhancements

Additional non-sensitive settings that could be migrated from `.env` to App Settings:

**Feature Flags:**
- `REGISTRATION_ENABLED` → `feature.registration_enabled` (boolean)
- `CRON_ENABLE` → `feature.cron_enabled` (boolean)
- `WEBSITE_AUTO_DELETE_ENABLED` → `feature.website_auto_delete` (boolean)

**Rate Limiting:**
- `UNAUTH_SEARCH_LIMIT_PER_SECOND` → `rate.unauth_search_per_second` (integer)

**Session & Authentication:**
- `SESSION_DURATION_DAYS` → `session.duration_days` (integer)
- `PASSWORD_MIN_LENGTH` → `password.min_length` (integer)
- `PASSWORD_MIN_ALPHA` → `password.min_alpha` (integer)
- `PASSWORD_MIN_SYMBOLS` → `password.min_symbols` (integer)
- `PASSWORD_MIN_NUMERIC` → `password.min_numeric` (integer)
- `PASSWORD_MIN_UPPERCASE` → `password.min_uppercase` (integer)
- `PASSWORD_MIN_LOWERCASE` → `password.min_lowercase` (integer)
- `PASSWORD_RESET_TOKEN_DURATION` → `password.reset_token_duration` (integer)

**Operational Limits:**
- `LIST_PAGE_SIZE` → `ui.list_page_size` (integer)
- `MAX_API_KEYS_PER_USER` → `limits.max_api_keys_per_user` (integer)
- `API_LOG_RETENTION_DAYS` → `retention.api_logs_days` (integer)
- `WEBSITE_AUTO_DELETE_DAYS` → `retention.website_auto_delete_days` (integer)

**Reporting:**
- `REPORTING_HOUR` → `report.delivery_hour` (integer)
- `REPORTING_BATCH_SIZE` → `report.batch_size` (integer)
- `REPORTING_HEADING` → `report.email_heading` (string)
- `REPORTING_OPENING_PARAGRAPH` → `report.email_opening` (string)
- `REPORTING_CLOSING_PARAGRAPH` → `report.email_closing` (string)
- `REPORTING_SIGN_OFF` → `report.email_signoff` (string)
- `REPORTING_POST_SCRIPT` → `report.email_postscript` (string)

**WordPress.org Integration:**
- `WPORG_UPDATE_BATCH_SIZE` → `batch.wporg_update_size` (integer)
- `WPORG_TIMEOUT_MS` → `wporg.timeout_ms` (integer)

## Migration Strategy

For v1.10.0 users, provide a migration script that:
1. Reads current environment variables
2. Creates corresponding app_settings entries
3. Logs the migration for review
4. Keeps env vars as fallback until v2.0.0
