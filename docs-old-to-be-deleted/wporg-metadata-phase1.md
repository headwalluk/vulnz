# WordPress.org Metadata Integration - Phase 1

## Overview

Added four new fields to the `components` table to capture WordPress.org plugin metadata for security monitoring and reporting.

## New Fields

### 1. `added` (DATE, nullable)

- **Purpose**: Track when plugin was first published to WordPress.org
- **Security Use**: Identify newly published plugins (<3 months) that may warrant extra scrutiny
- **Format**: `YYYY-MM-DD` (e.g., `2025-10-19`)
- **Source**: `data.added` from WordPress.org API

### 2. `last_updated` (DATETIME, nullable)

- **Purpose**: Track when plugin was last updated
- **Security Use**: Flag abandoned/unmaintained plugins (6+ months without updates, configurable)
- **Format**: `YYYY-MM-DD HH:MM:SS` (e.g., `2025-11-13 13:39:00`)
- **Source**: `data.last_updated` from WordPress.org API
- **Note**: Parsed from format like "2025-11-13 1:39pm GMT" to MySQL DATETIME

### 3. `requires_php` (VARCHAR(10), nullable)

- **Purpose**: Minimum PHP version required by plugin
- **Security Use**:
  - Identify plugins holding back PHP upgrades
  - Cross-reference with site's PHP version for compatibility warnings
- **Format**: Semantic version (e.g., `8.1`, `7.4`)
- **Source**: `data.requires_php` from WordPress.org API

### 4. `tested` (VARCHAR(10), nullable)

- **Purpose**: WordPress version plugin was tested up to
- **Security Use**: Flag plugins not tested with current WordPress version
- **Format**: Semantic version (e.g., `6.8.3`, `6.7.1`)
- **Source**: `data.tested` from WordPress.org API

## Implementation Details

### Migration

- **File**: `src/migrations/20251210100000-add-wporg-metadata-to-components.js`
- **Operation**: `ALTER TABLE components ADD COLUMN ...` (x4)
- **Idempotent**: Handles `ER_DUP_FIELDNAME` error gracefully

### WordPress.org Sync Updates

- **File**: `src/lib/wporg.js`
- **New Functions**:
  - `parseWpOrgDateTime(dateStr)` - Converts "2025-11-13 1:39pm GMT" → "2025-11-13 13:39:00"
  - `parseWpOrgDate(dateStr)` - Validates and passes through "2025-10-19" format
- **Updated**: `syncNextPlugin()` now captures all four fields during plugin sync

### Date Parsing Logic

**parseWpOrgDateTime:**

```
Input:  "2025-11-13 1:39pm GMT"
Output: "2025-11-13 13:39:00"

Handles:
- 12-hour format with am/pm
- Single or double digit hours (1:39pm vs 11:39am)
- Converts to 24-hour MySQL DATETIME format
- Returns null for invalid input
```

**parseWpOrgDate:**

```
Input:  "2025-10-19"
Output: "2025-10-19"

Validates:
- YYYY-MM-DD format
- Returns null for invalid input
```

## NULL Values

All four fields are nullable. NULL indicates:

- **Premium/non-WordPress.org plugins** (not in repository)
- **Data not available** from WordPress.org API
- **Pre-migration plugins** (synced before this update)

When `last_updated IS NULL`, plugin can be safely ignored in "abandoned plugin" reports (likely premium).

## Testing

### Verification Steps

1. Run migration: Application startup will auto-apply
2. Check schema: `DESCRIBE components;`
3. Trigger sync: Wait for cron or manually call `syncNextPlugin()`
4. Verify data: `SELECT slug, added, last_updated, requires_php, tested FROM components WHERE synced_from_wporg = 1 LIMIT 10;`

### Test Results

- ✅ All existing tests pass (28/28)
- ✅ No linting errors
- ✅ Migration file created
- ✅ Sync code updated

## Next Steps (Phase 2)

### Reporting Integration

1. Add "Unmaintained Plugins" section to weekly reports
2. Configuration:
   - `plugin.unmaintained_threshold_months` (default: 6)
   - Show plugins with `last_updated < (NOW() - INTERVAL X MONTH)`
   - Exclude plugins where `last_updated IS NULL`
3. Add "Newly Published Plugins" section
   - Show plugins with `added > (NOW() - INTERVAL 3 MONTH)`
   - Flag for extra monitoring

### Additional Enhancements

1. PHP version compatibility warnings
   - Compare `requires_php` with site's `php_version`
   - Flag sites running older PHP than plugin requires
2. WordPress compatibility warnings
   - Compare `tested` with site's `wordpress_version`
   - Flag plugins not tested with current WP version

## Files Modified

- `src/migrations/20251210100000-add-wporg-metadata-to-components.js` (new)
- `src/lib/wporg.js` (modified)
- `test-wporg-dates.js` (new, for manual testing)

## Database Impact

- **Table**: `components`
- **New Columns**: 4 (added, last_updated, requires_php, tested)
- **Index Considerations**: None needed yet (will add if querying by date ranges)
- **Size Impact**: Minimal (~20 bytes per row)
