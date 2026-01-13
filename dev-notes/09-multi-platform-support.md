# Multi-Platform Support

Planning document for expanding Vulnz beyond WordPress to support multiple component ecosystems.

**Status**: Planning  
**Created**: January 5, 2026  
**Last Updated**: January 5, 2026

---

## Overview

Vulnz currently tracks WordPress components (plugins & themes). This document outlines the architecture for expanding to support additional component ecosystems like npm (Node.js packages), PyPI (Python packages), Composer (PHP packages), etc.

### Terminology

**Critical distinction to maintain consistent terminology:**

- **Ecosystem** = Component ecosystem (npm, wordpress, pypi, composer)
  - Defines what components/packages we track
  - Links to vulnerability databases and metadata sources
  - Examples: WordPress plugins/themes, npm packages, Python packages
- **Platform** = Runtime/infrastructure details for a specific website
  - WordPress ecosystem → platform: WordPress version, PHP version, database engine/version
  - npm ecosystem → platform: Node.js version, package manager version
  - PyPI ecosystem → platform: Python version, virtualenv details
  - Stored as flexible JSON (varies per ecosystem)

**Why this matters:**

- A website has ONE ecosystem (keeps architecture simple)
- Each ecosystem defines its own platform metadata requirements
- Components belong to ecosystems, not platforms
- Vulnerability feeds are ecosystem-specific

### Key Architectural Principles

1. **One ecosystem per website** - No hybrid website support (edge case, adds complexity)
2. **Flexible platform metadata** - JSON field allows ecosystem-specific data without schema changes
3. **Ecosystem configuration** - Centralized in `ecosystems` table with JSON for API URLs, etc.
4. **Component types belong to ecosystems** - wordpress-plugin, npm-package, etc.

---

## Current Architecture (WordPress-Only)

### How Vulnz Works Today

1. **External tools push website configurations via API**
   - Website domain, title, etc.
   - List of installed WordPress plugins/themes with versions
   - Example: `{ domain: "example.com", components: [{ slug: "akismet", version: "5.0" }] }`

2. **Vulnz stores this data**
   - Creates/updates website record
   - Links components to website (via `website_components` join table)
   - Creates component/release records if they don't exist

3. **(Optional) WordPress.org metadata sync**
   - Nice-to-have feature, not critical
   - Fetches component metadata from wordpress.org API
   - Stores author, description, requirements, etc.

4. **Vulnerability data from bulk feeds**
   - External script downloads Wordfence data feed (daily)
   - Script: `scripts/process-wordfence-feed.sh`
   - Processes entire feed and inserts/updates vulnerability records
   - **Why bulk?** Avoids hammering Wordfence API with hundreds of individual requests
   - **Why external?** Large JSON file, processed once daily, not on-demand

5. **Weekly security reports**
   - Cron job generates reports for each user
   - Identifies vulnerable components across their websites
   - Emails white-labeled reports

### WordPress-Specific Elements in Current Schema

**Tables that need updating:**

```sql
-- Currently has WordPress-specific columns
websites (
  wordpress_version VARCHAR(50),  -- Platform-specific
  php_version VARCHAR(50),        -- Platform-specific
  db_server_type VARCHAR(50)      -- Platform-specific
)

-- Currently only has wordpress-plugin, wordpress-theme
component_types (
  slug VARCHAR(255),  -- e.g., 'wordpress-plugin', 'npm-package'
  name VARCHAR(255)   -- e.g., 'WordPress Plugin', 'npm Package'
)

-- Generic, no changes needed
components (
  type_id BIGINT,
  slug VARCHAR(255),
  name VARCHAR(255),
  -- Has wporg_* fields but these can coexist with npm_*, pypi_* fields
)
```

---

## Proposed Architecture (Multi-Ecosystem)

### 1. Ecosystems Table

**New table to define supported component ecosystems:**

```sql
CREATE TABLE ecosystems (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(50) NOT NULL UNIQUE,           -- 'wordpress', 'npm', 'pypi', 'composer'
  name VARCHAR(100) NOT NULL,                 -- 'WordPress', 'npm', 'PyPI', 'Composer'
  description TEXT NULL,                      -- Human-readable description
  data JSON NULL,                             -- Flexible ecosystem configuration
  active BOOLEAN DEFAULT TRUE,                -- Ecosystem enabled/disabled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed initial ecosystems
INSERT INTO ecosystems (slug, name, data) VALUES
  ('wordpress', 'WordPress', JSON_OBJECT(
    'urlBase', 'https://api.wordpress.org',
    'vulnerabilityFeed', 'https://www.wordfence.com/api/intelligence/v2/vulnerabilities/production',
    'metadataSync', true
  )),
  ('npm', 'npm', JSON_OBJECT(
    'v1', 'https://registry.npmjs.org',
    'v2', 'https://api.npms.io/v2',
    'vulnerabilityFeed', 'https://api.osv.dev/v1/query',
    'metadataSync', false
  )),
  ('pypi', 'PyPI', JSON_OBJECT(
    'urlBase', 'https://pypi.org/pypi',
    'vulnerabilityFeed', 'https://api.osv.dev/v1/query',
    'metadataSync', false
  ));
```

**Rationale:**

- Centralizes ecosystem configuration
- JSON `data` field provides flexibility for ecosystem-specific settings
- Makes adding new ecosystems a data operation, not a code change
- Stores vulnerability feed URLs for external processing scripts
- Each ecosystem can define its own configuration structure

### 2. Link Component Types to Ecosystems

**Update `component_types` table:**

```sql
ALTER TABLE component_types
  ADD COLUMN ecosystem_id BIGINT UNSIGNED NOT NULL AFTER id,
  ADD FOREIGN KEY (ecosystem_id) REFERENCES ecosystems(id) ON DELETE CASCADE;

-- Update existing types
UPDATE component_types
  SET ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress')
  WHERE slug IN ('wordpress-plugin', 'wordpress-theme');

-- Add new types
INSERT INTO component_types (ecosystem_id, slug, name) VALUES
  ((SELECT id FROM ecosystems WHERE slug = 'npm'), 'npm-package', 'npm Package'),
  ((SELECT id FROM ecosystems WHERE slug = 'pypi'), 'pypi-package', 'Python Package'),
  ((SELECT id FROM ecosystems WHERE slug = 'composer'), 'composer-package', 'Composer Package');
```

**Result:**

- Each component type belongs to an ecosystem
- Can query "all components in the npm ecosystem"
- Can have multiple types per ecosystem (e.g., wordpress-plugin, wordpress-theme both belong to WordPress)

### 3. Update Websites Table

**Add ecosystem and platform metadata to websites:**

```sql
ALTER TABLE websites
  ADD COLUMN ecosystem_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN platform_metadata JSON NULL AFTER meta,
  ADD FOREIGN KEY (ecosystem_id) REFERENCES ecosystems(id) ON DELETE SET NULL,
  ADD INDEX ecosystem_idx (ecosystem_id);

-- Migrate existing WordPress websites
UPDATE websites
  SET ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress'),
      platform_metadata = JSON_OBJECT(
        'name', 'WordPress',
        'version', wordpress_version,
        'phpVersion', php_version,
        'databaseEngine', db_server_type,
        'databaseVersion', db_server_version
      );

-- Optional: Remove old columns after migration confirmed
-- ALTER TABLE websites
--   DROP COLUMN wordpress_version,
--   DROP COLUMN php_version,
--   DROP COLUMN db_server_type,
--   DROP COLUMN db_server_version;
```

**Design Decision: One Ecosystem Per Website**

**Why?**

- Keeps architecture simple and maintainable
- Hybrid websites (e.g., WordPress + npm on same domain) are edge cases
- Most real-world use cases involve one primary ecosystem per website
- Reduces query complexity
- Easier to reason about and report on

**If hybrid support is needed later:**

- Can add a many-to-many join table
- Current architecture doesn't prevent future expansion
- Focus on the 95% use case first

**Platform Metadata Examples:**

```json
// WordPress ecosystem
{
  "name": "WordPress",
  "version": "6.4.2",
  "phpVersion": "8.2.0",
  "databaseEngine": "MariaDB",
  "databaseVersion": "10.0.0"
}

// npm ecosystem
{
  "name": "Node.js",
  "version": "20.0.0",
  "packageManager": "npm",
  "packageManagerVersion": "10.2.3"
}

// PyPI ecosystem
{
  "name": "Python",
  "version": "3.11.5",
  "packageManager": "pip",
  "virtualenv": true,
  "databaseEngine": "PostgreSQL",
  "databaseVersion": "15.0"
}
```

**Flexibility:**

- Each ecosystem can define its own platform metadata structure
- No schema changes needed to track new platform details
- External tools pushing data can include any relevant platform info

### 4. API Updates

**Website creation - now accepts ecosystem and platform metadata:**

```javascript
// POST /api/websites
{
  "domain": "example-one.com",
  "title": "Example Website",
  "is_ssl": true,
  "meta": {
    "Server": "hhw6.headwall-hosting.com",
    "Login": "http://example-one.com/admin",
    "Admin email": "admin@example-one.com"
  },
  "ecosystem": "npm",
  "platform": {
    "name": "Node.js",
    "version": "20.0.0"
  },
  "components": [
    { "slug": "express", "version": "4.18.2", "type": "npm-package" },
    { "slug": "axios", "version": "1.6.0", "type": "npm-package" }
  ]
}
```

```javascript
// WordPress example
{
  "domain": "example-two.com",
  "title": "WordPress Site",
  "is_ssl": true,
  "meta": {
    "Server": "hhw1.headwall-hosting.com",
    "Login": "http://example-two.com/wp-login.php",
    "Admin email": "admin@example-two.com"
  },
  "ecosystem": "wordpress",
  "platform": {
    "name": "WordPress",
    "version": "6.9",
    "databaseEngine": "MariaDB",
    "databaseVersion": "10.0.0"
  },
  "components": [
    { "slug": "akismet", "version": "5.0", "type": "wordpress-plugin" },
    { "slug": "twentytwentyfour", "version": "1.0", "type": "wordpress-theme" }
  ]
}
```

**Backward compatibility:**

```javascript
// OLD API (still works) - assumes WordPress ecosystem
{
  "domain": "example.com",
  "wordpress_version": "6.4.2",
  "wordpress_plugins": [
    { "slug": "akismet", "version": "5.0" }
  ]
}

// Internally converted to new format:
{
  "ecosystem": "wordpress",
  "platform": {
    "name": "WordPress",
    "version": "6.4.2"
  },
  "components": [
    { "slug": "akismet", "version": "5.0", "type": "wordpress-plugin" }
  ]
}
```

### 5. Vulnerability Feed Processing

**Each ecosystem needs its own feed processor:**

```bash
scripts/
process-wordfence-feed.sh       # WordPress vulnerabilities (existing)
process-npm-vulnerabilities.sh  # npm vulnerabilities (new)
process-pypi-vulnerabilities.sh # Python vulnerabilities (new)
```

**Why separate scripts?**

- Different data sources (Wordfence, OSV.dev, GitHub Advisory, etc.)
- Different data formats (JSON, API, RSS)
- Different update frequencies
- Can run independently on different schedules

**Example npm vulnerability processor:**

```bash
#!/bin/bash
# scripts/process-npm-vulnerabilities.sh

# Uses OSV.dev (Open Source Vulnerabilities) API
# Queries for npm ecosystem vulnerabilities

# 1. Get all unique npm packages from database
# 2. For each package, query OSV.dev API
# 3. Insert/update vulnerability records
# 4. Link vulnerabilities to releases

# Rate limiting: OSV.dev allows batch queries
# Process in batches of 100 packages
```

**Alternative approach - Download bulk database:**

Some vulnerability sources offer full database dumps:

- OSV.dev provides downloadable snapshots
- GitHub Advisory Database is on GitHub
- Could download entire database, process locally

**Question for discussion:** Should we query APIs or download bulk databases?

#### Vulnerability Severity Levels

**Add severity tracking to vulnerabilities:**

Different ecosystems use different severity scales (CVSS, custom ratings), so we normalize to a simple 3-level system:

```sql
ALTER TABLE vulnerabilities
  ADD COLUMN severity ENUM('unknown', 'medium', 'high') NOT NULL DEFAULT 'unknown';
```

**Severity Mapping:**

- **high** - Critical/High severity (CVSS 7.0+, or marked as critical by source)
- **medium** - Medium severity (CVSS 4.0-6.9, or moderate risk)
- **unknown** - Severity not provided or cannot be determined

**Note:** No "low" severity - if it's truly low risk, it shouldn't be tracked as a vulnerability.

**Data Sources:**

- **Wordfence**: Provides severity ratings (can be mapped to our scale)
- **OSV.dev**: Provides CVSS scores in vulnerability data
  ```json
  {
    "severity": [
      {
        "type": "CVSS_V3",
        "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
      }
    ]
  }
  ```
- **Mapping logic**: Parse CVSS base score (0-10) → high (7.0+) | medium (4.0-6.9) | unknown

**Benefits:**

- Users can filter/prioritize by severity
- Reports can highlight critical issues first
- Future: Allow users to set notification preferences (e.g., "only email me for high severity")
- Color coding in reports (red for high, orange for medium)

**Implementation:**

```javascript
function mapSeverity(cvssScore) {
  if (cvssScore === null || cvssScore === undefined) {
    return 'unknown';
  }
  if (cvssScore >= 7.0) {
    return 'high';
  }
  if (cvssScore >= 4.0) {
    return 'medium';
  }
  return 'medium'; // Anything below 4.0 still counts as medium
}
```

### 6. Component Metadata Sync (Optional)

**Similar to WordPress.org sync, but for other ecosystems:**

```javascript
// src/lib/metadata-sync/wordpress.js (existing, refactored)
// src/lib/metadata-sync/npm.js (new)
// src/lib/metadata-sync/pypi.js (new)

// Each implements:
async function syncComponent(slug, ecosystem) {
  // Fetch from registry using ecosystem configuration
  // Update component record
}
```

**For npm:**

- API: `https://registry.npmjs.org/${packageName}`
- Returns: name, description, author, versions, repository, etc.

**For PyPI:**

- API: `https://pypi.org/pypi/${packageName}/json`
- Returns: name, summary, author, version, etc.

---

## Reporting Updates

### Current Report Strengths (Must Preserve)

✅ **Zero-click experience** - Clients can scan and understand without additional work  
✅ **Non-scary presentation** - Feels like actionable tasks, not overwhelming homework  
✅ **Clear vulnerability list** - Easy to work through critical issues

**These qualities must be maintained in multi-ecosystem reports.**

### Client Scenarios

**Typical client profiles:**

1. **WordPress-only (most common)**: 1-10 WordPress sites, usually 2 (production + staging)
2. **Mixed ecosystem**: 1-10 WordPress sites + 1-2 Node.js sites
3. **npm-only (less common)**: 1-5 Node.js applications

### Reporting Requirements

#### 1. Critical Issues Section

**Current approach works for all ecosystems - minimal changes needed.**

The vulnerability list format is ecosystem-agnostic:

- Show component name (plugin, package, theme, etc.)
- Show version
- Show affected websites
- Link to vulnerability details

**Only change needed: Dynamic terminology**

```
WordPress plugin example:
❌ Akismet 5.0 (plugin)
   Vulnerability: CVE-2024-xxxx
   Affected: example.com, staging.example.com

npm package example:
❌ lodash 4.17.20 (package)
   Vulnerability: CVE-2024-yyyy
   Affected: app.example.com
```

Component type determines the label:

- `wordpress-plugin` → "plugin"
- `wordpress-theme` → "theme"
- `npm-package` → "package"
- `pypi-package` → "package"
- `composer-package` → "package"

#### 2. Summary Section (Needs Dynamic Generation)

**Current summary shows WordPress-specific stats:**

```
📊 Summary
- Monitored websites: 5
- Total components: 42
- Vulnerable components: 3
- Outdated WordPress: 2
- Outdated PHP: 1
```

**Problem:** WordPress-only clients shouldn't see `Outdated Node.js: 0`  
**Problem:** npm-only clients shouldn't see `Outdated WordPress: 0`

**Solution: Ecosystem-aware summary generation**

**WordPress-only client:**

```
📊 Summary
- Monitored websites: 5 (WordPress)
- Total components: 42
- Vulnerable components: 3
- Outdated WordPress: 2
- Outdated PHP: 1
- Outdated databases: 1
```

**npm-only client:**

```
📊 Summary
- Monitored websites: 3 (Node.js)
- Total packages: 156
- Vulnerable packages: 12
- Outdated Node.js: 1
```

**Mixed ecosystem client:**

```
📊 Summary
- Monitored websites: 7
  - WordPress sites: 5
  - Node.js apps: 2

WordPress Ecosystem:
- Total components: 42
- Vulnerable components: 3
- Outdated WordPress: 2
- Outdated PHP: 1

Node.js Ecosystem:
- Total packages: 156
- Vulnerable packages: 12
- Outdated Node.js: 1
```

**Implementation approach:**

```javascript
function generateSummary(user) {
  const websites = await Website.findByUser(user.id);
  const ecosystems = [...new Set(websites.map(w => w.ecosystem_id))];

  if (ecosystems.length === 1) {
    // Single ecosystem - show unified summary
    return generateSingleEcosystemSummary(websites, ecosystems[0]);
  } else {
    // Multiple ecosystems - show grouped summary
    return generateMultiEcosystemSummary(websites, ecosystems);
  }
}
```

#### 3. Template Structure

**Keep existing single-column email layout:**

```
┌──────────────────────────────────────┐
│ [White Label Header/Logo]            │
├──────────────────────────────────────┤
│ 📧 Weekly Security Report            │
│    January 5, 2026                   │
├──────────────────────────────────────┤
│ 🚨 Critical Issues (5)               │
│                                      │
│ [List of vulnerabilities]            │
│ - Ecosystem-agnostic format          │
│ - Dynamic component type labels      │
├──────────────────────────────────────┤
│ 📊 Summary                           │
│                                      │
│ [Dynamic based on ecosystems]        │
│ - Single ecosystem: unified          │
│ - Multiple ecosystems: grouped       │
├──────────────────────────────────────┤
│ ✅ All Clear / ⚠️ Warnings          │
│                                      │
│ [Optional additional info]           │
├──────────────────────────────────────┤
│ [Footer]                             │
└──────────────────────────────────────┘
```

#### 4. Terminology Mapping

**Map component types to user-friendly terms:**

```javascript
const componentTypeLabels = {
  'wordpress-plugin': 'plugin',
  'wordpress-theme': 'theme',
  'npm-package': 'package',
  'pypi-package': 'package',
  'composer-package': 'package',
  'rubygems-package': 'gem',
  'maven-package': 'dependency',
};
```

**Map ecosystems to platform names:**

```javascript
const ecosystemPlatformLabels = {
  wordpress: {
    runtime: 'WordPress',
    language: 'PHP',
    database: 'database',
  },
  npm: {
    runtime: 'Node.js',
    language: 'JavaScript',
    database: 'database', // if applicable
  },
  pypi: {
    runtime: 'Python',
    language: 'Python',
    database: 'database',
  },
};
```

### Implementation Priority

**This work comes AFTER structural changes:**

1. ✅ Database schema updates
2. ✅ API updates
3. ✅ npm vulnerability feed processing
4. 🔄 **THEN: Reporting updates**

### Testing Strategy

**Create test reports for:**

- [ ] WordPress-only client (2 sites, 5 vulnerable components)
- [ ] npm-only client (1 site, 12 vulnerable packages)
- [ ] Mixed client (3 WordPress + 1 npm, vulnerabilities in both)
- [ ] Client with no vulnerabilities (all clear message)
- [ ] Client with outdated platforms (old WordPress, old Node.js)

**Validation criteria:**

- Zero-click readability maintained
- Non-scary presentation preserved
- Summary only shows relevant ecosystem data
- Terminology correct for each component type
- White-labeling still works

---

## Implementation Phases

### Phase 0: API Versioning (HIGH PRIORITY - Do First)

- [ ] Design API versioning strategy (/api/v1, /api/v2)
- [ ] Create v2 API structure with ecosystem support
- [ ] Maintain v1 API endpoints (WordPress-only format)
- [ ] Add deprecation warnings to v1 API responses
- [ ] Update API documentation for both versions
- [ ] Update vulnz-agent WordPress plugin to use v2 API
- [ ] Update internal scripts to use v2 API
- [ ] Test backward compatibility (v1 still works)
- [ ] Set deprecation timeline for v1 (e.g., 12 months)

### Phase 1: Database Schema

- [ ] Create `ecosystems` table with JSON data field
- [ ] Add `ecosystem_id` to `component_types`
- [ ] Add `ecosystem_id` and `platform_metadata` to `websites` table
- [ ] Add `severity` ENUM to `vulnerabilities` table (unknown, medium, high)
- [ ] Migrate existing WordPress data
- [ ] Seed ecosystems: wordpress, npm, pypi
- [ ] Create migration scripts with rollback

### Phase 2: API Updates

- [ ] Update POST /api/v2/websites to accept ecosystem and platform metadata
- [ ] Maintain v1 API endpoints with backward compatibility
- [ ] Update GET /api/v2/websites to return ecosystem and platform information
- [ ] Add filtering by ecosystem
- [ ] Update component endpoints to handle ecosystem filtering
- [ ] Create GET /api/v2/ecosystems endpoint

### Phase 3: npm Support

- [ ] Add npm ecosystem and component type to database
- [ ] Create npm vulnerability feed processor script
- [ ] Extract and map CVSS scores to severity levels (high/medium/unknown)
- [ ] Update Wordfence processor to extract/map severity levels
- [ ] Test with real npm package data
- [ ] Document npm integration for users

### Phase 4: Reporting Updates

- [ ] Update email templates to show ecosystem-specific sections
- [ ] Implement dynamic summary generation (single vs multi-ecosystem)
- [ ] Add component type label mapping
- [ ] Add severity-based highlighting (high = red, medium = orange)
- [ ] Sort vulnerabilities by severity (high first)
- [ ] Test all client scenarios (WordPress-only, npm-only, mixed)
- [ ] Ensure white-labeling still works

### Phase 5: Additional Ecosystems (Future)

- [ ] PyPI (Python packages)
- [ ] Composer (PHP packages)
- [ ] RubyGems (Ruby gems)
- [ ] Maven (Java packages)

---

## Open Questions & Decisions Needed

### 1. Website-Ecosystem Relationship ✅ RESOLVED

**Decision:** One ecosystem per website (simple architecture)

**Rationale:**

- Hybrid websites are edge cases
- Keeps queries simple
- Easier to maintain and reason about
- Can be extended later if truly needed

### 2. Vulnerability Data Sources

**For npm packages, which source(s) to use?**

Options:

- **OSV.dev** (Google's Open Source Vulnerabilities)
  - ✅ Free, comprehensive, well-maintained
  - ✅ Covers npm, PyPI, Maven, Go, etc.
  - ✅ Has API and downloadable database
  - ✅ Structured JSON format
- **GitHub Advisory Database**
  - ✅ Free, comprehensive
  - ✅ Community-maintained
  - ✅ Available as Git repository
  - ❌ Requires parsing different format
- **npm audit** (npm's built-in audit)
  - ✅ Official npm source
  - ❌ Rate limited
  - ❌ Requires querying per package
- **Snyk Vulnerability Database**
  - ✅ Very comprehensive
  - ❌ Requires paid API access for bulk queries
  - ✅ Free tier available but limited

**Current recommendation:** Start with OSV.dev (free, comprehensive, good API)

### 3. Bulk Processing Strategy

**How to process npm vulnerabilities given hundreds of packages?**

**Option A: Download OSV.dev database snapshot**

- Download full database (~GB of data)
- Process locally with SQL queries
- Update daily

**Option B: Batch API queries**

- OSV.dev supports batch queries (100+ at once)
- Query only for packages we're tracking
- More efficient, less storage

**Current recommendation:** Option B (batch API queries) - only fetch what we need

### 4. Component Metadata Sync

**Should we sync npm package metadata like we do for WordPress.org?**

**Pros:**

- Richer component information
- Better reporting (show package descriptions, authors)
- Can display latest available version

**Cons:**

- Not critical for core functionality
- Adds complexity
- npm registry has rate limits

**Current recommendation:** Skip for initial release, add later if needed

### 5. Ecosystem Detection ✅ RESOLVED

**Should Vulnz attempt to auto-detect ecosystems, or rely on external tools?**

**Decision:** External tools specify ecosystem explicitly in API payload

**Rationale:**

- Vulnz receives data via API (doesn't actively scan websites)
- External tools (WordPress plugin, custom scripts) know what they're scanning
- Ecosystem detection is the responsibility of the data source

---

## API Design Examples

### Create Website with npm Ecosystem

```http
POST /api/websites
X-API-Key: abc123

{
  "domain": "example-one.com",
  "title": "Node.js Application",
  "is_ssl": true,
  "meta": {
    "Server": "hhw6.headwall-hosting.com",
    "Login": "http://example-one.com/admin",
    "Admin email": "admin@example-one.com"
  },
  "ecosystem": "npm",
  "platform": {
    "name": "Node.js",
    "version": "20.0.0"
  },
  "components": [
    {
      "slug": "express",
      "version": "4.18.2",
      "type": "npm-package"
    },
    {
      "slug": "lodash",
      "version": "4.17.20",
      "type": "npm-package"
    }
  ]
}
```

### Create Website with WordPress Ecosystem

```http
POST /api/websites
X-API-Key: abc123

{
  "domain": "example-two.com",
  "title": "WordPress Site",
  "is_ssl": true,
  "meta": {
    "Server": "hhw1.headwall-hosting.com",
    "Login": "http://example-two.com/wp-login.php",
    "Admin email": "admin@example-two.com"
  },
  "ecosystem": "wordpress",
  "platform": {
    "name": "WordPress",
    "version": "6.9",
    "databaseEngine": "MariaDB",
    "databaseVersion": "10.0.0"
  },
  "components": [
    {
      "slug": "akismet",
      "version": "5.0",
      "type": "wordpress-plugin"
    },
    {
      "slug": "twentytwentyfour",
      "version": "1.0",
      "type": "wordpress-theme"
    }
  ]
}
```

### Update Website Components

```http
PUT /api/websites/123/components
X-API-Key: abc123

{
  "components": [
    {
      "slug": "express",
      "version": "4.18.3"  // Updated version
    },
    {
      "slug": "axios",
      "version": "1.6.2"   // New package
    }
  ]
}
```

### List Ecosystems

```http
GET /api/ecosystems

Response:
[
  {
    "id": 1,
    "slug": "wordpress",
    "name": "WordPress",
    "active": true
  },
  {
    "id": 2,
    "slug": "npm",
    "name": "npm",
    "active": true
  },
  {
    "id": 3,
    "slug": "pypi",
    "name": "PyPI",
    "active": true
  }
]
```

---

## Migration Strategy

### Existing WordPress Installations

1. **Create ecosystems table** with WordPress entry
2. **Update component_types** to link to WordPress ecosystem
3. **Migrate websites data** to include ecosystem_id and platform_metadata
4. **Maintain backward compatibility** - old API format still works

### Database Migration

```javascript
// migrations/20260105000000-add-multi-ecosystem-support.js

exports.up = async function (db) {
  // 1. Create ecosystems table
  await db.query(`
    CREATE TABLE ecosystems (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description TEXT NULL,
      data JSON NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 2. Insert initial ecosystems
  await db.query(`
    INSERT INTO ecosystems (slug, name, data) VALUES
      ('wordpress', 'WordPress', JSON_OBJECT(
        'urlBase', 'https://api.wordpress.org',
        'vulnerabilityFeed', 'https://www.wordfence.com/api/intelligence/v2/vulnerabilities/production',
        'metadataSync', true
      )),
      ('npm', 'npm', JSON_OBJECT(
        'v1', 'https://registry.npmjs.org',
        'v2', 'https://api.npms.io/v2',
        'vulnerabilityFeed', 'https://api.osv.dev/v1/query',
        'metadataSync', false
      )),
      ('pypi', 'PyPI', JSON_OBJECT(
        'urlBase', 'https://pypi.org/pypi',
        'vulnerabilityFeed', 'https://api.osv.dev/v1/query',
        'metadataSync', false
      ))
  `);

  // 3. Add ecosystem_id to component_types
  await db.query(`ALTER TABLE component_types ADD COLUMN ecosystem_id BIGINT UNSIGNED NOT NULL AFTER id`);
  await db.query(`ALTER TABLE component_types ADD FOREIGN KEY (ecosystem_id) REFERENCES ecosystems(id) ON DELETE CASCADE`);
  await db.query(`UPDATE component_types SET ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress')`);

  // 4. Add ecosystem fields to websites table
  await db.query(`ALTER TABLE websites ADD COLUMN ecosystem_id BIGINT UNSIGNED NULL AFTER user_id`);
  await db.query(`ALTER TABLE websites ADD COLUMN platform_metadata JSON NULL AFTER meta`);
  await db.query(`ALTER TABLE websites ADD FOREIGN KEY (ecosystem_id) REFERENCES ecosystems(id) ON DELETE SET NULL`);
  await db.query(`ALTER TABLE websites ADD INDEX ecosystem_idx (ecosystem_id)`);

  // 5. Migrate existing websites to WordPress ecosystem
  await db.query(`
    UPDATE websites
    SET ecosystem_id = (SELECT id FROM ecosystems WHERE slug = 'wordpress'),
        platform_metadata = JSON_OBJECT(
          'name', 'WordPress',
          'version', wordpress_version,
          'phpVersion', php_version,
          'databaseEngine', db_server_type,
          'databaseVersion', db_server_version
        )
  `);

  // 6. Optional: Remove old columns after confirming migration
  // await db.query(`ALTER TABLE websites DROP COLUMN wordpress_version`);
  // await db.query(`ALTER TABLE websites DROP COLUMN php_version`);
  // await db.query(`ALTER TABLE websites DROP COLUMN db_server_type`);
  // await db.query(`ALTER TABLE websites DROP COLUMN db_server_version`);
};

exports.down = async function (db) {
  // Rollback logic
  await db.query(`ALTER TABLE websites DROP FOREIGN KEY websites_ibfk_ecosystem`);
  await db.query(`ALTER TABLE websites DROP INDEX ecosystem_idx`);
  await db.query(`ALTER TABLE websites DROP COLUMN platform_metadata`);
  await db.query(`ALTER TABLE websites DROP COLUMN ecosystem_id`);
  await db.query(`ALTER TABLE component_types DROP FOREIGN KEY component_types_ibfk_ecosystem`);
  await db.query(`ALTER TABLE component_types DROP COLUMN ecosystem_id`);
  await db.query(`DROP TABLE ecosystems`);
};
```

---

## Success Criteria

- [ ] Can track websites with WordPress components
- [ ] Can track websites with npm packages
- [ ] One ecosystem per website (simple, clean architecture)
- [ ] Vulnerability feeds processed for each ecosystem
- [ ] Weekly reports show vulnerabilities per ecosystem
- [ ] Reports adapt dynamically to client's ecosystems (no irrelevant data)
- [ ] Zero-click, non-scary report format preserved
- [ ] API accepts ecosystem and platform metadata
- [ ] Backward compatible with existing WordPress-only API
- [ ] Documentation updated
- [ ] Migration tested on production data

---

## Next Steps

1. **Review and finalize this document**
   - Agree on architectural decisions
   - Agree on vulnerability data sources
   - Agree on API format

2. **Implement Phase 1: Database Schema**
   - Create migration script
   - Test on development database
   - Document schema changes

3. **Implement Phase 2: API Updates**
   - Update website endpoints
   - Maintain backward compatibility
   - Add tests

4. **Implement Phase 3: npm Support**
   - Create npm vulnerability processor
   - Test with real npm data
   - Document integration

5. **Implement Phase 4: Reporting Updates**
   - Dynamic summary generation
   - Component type label mapping
   - Test all scenarios

6. **Update documentation**
   - API documentation
   - User guides
   - Migration guides

---

## Related Documents

- [00-project-tracker.md](./00-project-tracker.md) - Milestone 5: Multi-Platform Support
- [02-database-schema.md](./02-database-schema.md) - Current database schema
- [03-architecture-overview.md](./03-architecture-overview.md) - System architecture
