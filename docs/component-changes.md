# Component Changes Tracking

## Overview

Track when plugins and themes are added, removed, or updated on monitored websites. This provides an audit trail of component changes and enables security event correlation.

## Goals

- Record when components are added to websites
- Record when components are removed from websites
- Record when components are updated to new versions
- Provide audit trail for security investigations
- Enable "what changed" analysis in reports
- Support component change notifications in weekly reports

## Current Component Management

The existing `website_components` junction table tracks the current state of what components are installed:

```sql
website_components:
- website_id
- release_id
- PRIMARY KEY (website_id, release_id)
```

This tells us what's currently installed but doesn't provide change history.

## Data Model

### `component_changes` Table

Audit log of all component additions, removals, and updates.

**Schema**:

```sql
CREATE TABLE component_changes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id INT UNSIGNED NOT NULL,
  component_id INT UNSIGNED NOT NULL,
  change_type ENUM('added', 'removed', 'updated') NOT NULL,
  old_release_id INT UNSIGNED NULL,
  new_release_id INT UNSIGNED NULL,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  changed_by_user_id INT UNSIGNED NULL,
  changed_via ENUM('api', 'ui', 'sync', 'plugin') DEFAULT 'api',

  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
  FOREIGN KEY (old_release_id) REFERENCES releases(id) ON DELETE SET NULL,
  FOREIGN KEY (new_release_id) REFERENCES releases(id) ON DELETE SET NULL,
  FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_website_date (website_id, changed_at),
  INDEX idx_component (component_id),
  INDEX idx_change_type (change_type)
);
```

**Change Types**:

- `added`: Component newly installed (old_release_id = NULL, new_release_id = version)
- `removed`: Component uninstalled (old_release_id = version, new_release_id = NULL)
- `updated`: Component version changed (old_release_id = old version, new_release_id = new version)

**Changed Via**:

- `api`: Changed via VULNZ API endpoint
- `ui`: Changed through VULNZ web interface
- `sync`: Detected by automated sync/polling (future)
- `plugin`: Reported by VULNZ WordPress plugin (future)

## Integration Points

Component changes should be recorded wherever components are modified. This happens in several places:

### 1. Website Component Updates (Primary)

When `PUT /api/websites/:id` is called with a `components` array, we need to:

1. Compare incoming components with existing `website_components`
2. Detect additions, removals, and updates
3. Record changes in `component_changes` table
4. Update `website_components` table

**Location**: `src/routes/websites.js` - `processComponents()` function

**Current Implementation**:

```javascript
async function processComponents(websiteId, components) {
  // Delete all existing associations
  await WebsiteComponent.deleteByType(websiteId, 'plugin');
  await WebsiteComponent.deleteByType(websiteId, 'theme');

  // Add new associations
  for (const component of components) {
    const release = await Release.findOrCreate(...);
    await WebsiteComponent.create(websiteId, release.id);
  }
}
```

**Enhanced Implementation Needed**:

```javascript
async function processComponents(websiteId, components, userId = null) {
  // Get current components before changes
  const currentPlugins = await WebsiteComponent.getPlugins(websiteId);
  const currentThemes = await WebsiteComponent.getThemes(websiteId);

  // Process changes and record them
  await ComponentChange.recordChanges(websiteId, [...currentPlugins, ...currentThemes], components, userId, 'api');

  // Apply changes (existing logic)
  // ...
}
```

### 2. Individual Component Operations (Future)

New API endpoints for granular component management:

**POST /api/websites/:id/components**

- Add a single component
- Record `added` change

**DELETE /api/websites/:id/components/:releaseId**

- Remove a single component
- Record `removed` change

**PUT /api/websites/:id/components/:componentId**

- Update component to new version
- Record `updated` change with old and new release IDs

These endpoints don't exist yet but would provide finer-grained control.

### 3. Bulk Operations

When updating multiple websites or syncing from external sources, changes should still be recorded.

## Model Methods

### `ComponentChange.recordChanges()`

Static method to compare old and new component states and record changes.

```javascript
static async recordChanges(websiteId, oldComponents, newComponents, userId, changedVia) {
  // Compare old vs new
  // Detect added, removed, updated
  // Bulk insert into component_changes
  // Return summary: {added: 2, removed: 1, updated: 3}
}
```

### `ComponentChange.getRecentChanges()`

Query recent changes for reporting.

```javascript
static async getRecentChanges(websiteId, sinceDatetime = null) {
  // SELECT with JOINs to get component names, versions
  // Order by changed_at DESC
  // Return array of change objects
}
```

### `ComponentChange.getChangesByDateRange()`

For reporting, get all changes within a date range.

```javascript
static async getChangesByDateRange(startDate, endDate, websiteId = null) {
  // Filter by date range
  // Optional filter by website
  // Return grouped/summarized data
}
```

## Data Retention

Component changes are audit records and should be retained longer than security events.

**Configuration**:

```bash
COMPONENT_CHANGES_RETENTION_DAYS=365 # Default: 1 year
```

**Implementation**:

- `ComponentChange.removeOldChanges()` static method
- Called by cron job weekly (less frequent than security events)
- Purge changes older than retention period

**Rationale**:

- Useful for long-term analysis: "What was installed when this site was compromised 6 months ago?"
- Less privacy-sensitive than security events (no IP addresses)
- Relatively low volume compared to security events

## API Response Integration

When component operations are performed, include change summary in response:

**PUT /api/websites/:id with components**:

```json
{
  "website": {
    "id": 123,
    "domain": "example.com",
    ...
  },
  "component_changes": {
    "added": 2,
    "removed": 1,
    "updated": 3,
    "details": [
      {
        "change_type": "added",
        "component": "akismet",
        "version": "5.3.1"
      },
      {
        "change_type": "updated",
        "component": "wordpress-seo",
        "old_version": "21.5",
        "new_version": "21.6"
      }
    ]
  }
}
```

This provides immediate feedback about what changed.

## Reporting Integration

Component changes will be included in weekly vulnerability reports.

**Report Sections**:

1. **Component Changes Summary**
   - Total components added/removed/updated this week
   - Per website breakdown

2. **New Components**
   - List of newly installed components
   - Vulnerability check: "⚠️ New plugin X has known vulnerabilities"

3. **Removed Components**
   - List of uninstalled components
   - Good practice: "✓ Removed unused plugin Y"

4. **Component Updates**
   - List of version updates
   - Security context: "✓ Updated plugin Z to fix CVE-XXXX"

5. **Stale Components**
   - Components with available updates
   - "Update wordpress-seo from 21.5 to 21.6"

## Change Detection Strategies

### Option 1: API-Driven (Current Approach)

- Hosting provider POSTs current component list
- VULNZ compares with stored state
- Changes recorded automatically

**Pros**: Simple, works with current architecture
**Cons**: Only detects changes when API is called

### Option 2: Polling (Future Enhancement)

- VULNZ polls websites periodically
- Compares current state with stored state
- Records changes automatically

**Pros**: Detects changes even if not reported
**Cons**: Requires WordPress plugin or API access

### Option 3: WordPress Plugin (Future Enhancement)

- VULNZ WordPress plugin hooks into WordPress plugin/theme actions
- Reports changes in real-time
- Records who made the change (WordPress user)

**Pros**: Real-time, detailed context (which WP user)
**Cons**: Requires plugin installation

**Initial Implementation**: Option 1 (API-driven)

## Change Context Enhancement

Future enhancement: Capture additional context with changes.

**Possible Fields**:

- `notes`: Free-text field for change description
- `ticket_reference`: Link to support ticket or issue tracker
- `automated`: Boolean indicating if change was automated
- `rollback_of`: Reference to previous change being rolled back

Example:

```json
{
  "component": "wordpress-seo",
  "old_version": "21.6",
  "new_version": "21.5",
  "change_type": "updated",
  "notes": "Rolling back due to compatibility issue",
  "rollback_of": 12345
}
```

**Decision**: Defer this until proven necessary. Keep initial implementation simple.

## Security Considerations

Component changes can indicate security events:

**Suspicious Patterns**:

- Component added + immediate security events from that site
- Multiple components removed after breach (cleanup?)
- Rapid version changes (automated attack?)

**Integration with Security Events**:

- Cross-reference component changes with security event timeline
- Report: "Plugin X was added on Dec 1, first failed login on Dec 2"

This correlation helps identify attack vectors.

## Implementation Notes

- Compare components by `component_id` + `release_id`, not by slug/version strings
- Handle race conditions: use database transactions when recording changes
- Bulk insert changes for performance (single INSERT with multiple VALUES)
- Consider change_id sequence for ordering when timestamps are identical
- JOINs required for readable output: need component title and version from related tables

## Example Queries

**Website component history**:

```sql
SELECT
  cc.changed_at,
  cc.change_type,
  c.title AS component_name,
  r_old.version AS old_version,
  r_new.version AS new_version,
  u.username AS changed_by
FROM component_changes cc
JOIN components c ON cc.component_id = c.id
LEFT JOIN releases r_old ON cc.old_release_id = r_old.id
LEFT JOIN releases r_new ON cc.new_release_id = r_new.id
LEFT JOIN users u ON cc.changed_by_user_id = u.id
WHERE cc.website_id = 123
ORDER BY cc.changed_at DESC;
```

**Changes in date range (for reporting)**:

```sql
SELECT
  w.domain,
  COUNT(CASE WHEN cc.change_type = 'added' THEN 1 END) AS added,
  COUNT(CASE WHEN cc.change_type = 'removed' THEN 1 END) AS removed,
  COUNT(CASE WHEN cc.change_type = 'updated' THEN 1 END) AS updated
FROM component_changes cc
JOIN websites w ON cc.website_id = w.id
WHERE cc.changed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY w.id, w.domain;
```
