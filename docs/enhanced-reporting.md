# Enhanced Reporting

## Overview

Enhance the existing weekly vulnerability email reports to include security events, version information, static analysis results, and component changes. The goal is to provide website administrators with a comprehensive security overview in a single weekly email.

## Current Reporting System

**Implementation**: `src/lib/reporting.js`
**Template**: `src/emails/vulnerability-report.hbs`
**Schedule**: Every 10 minutes via cron (checks if it's time to send)
**Trigger**: Based on `users.last_summary_sent_at` timestamp

**Current Content**:

- List of websites with vulnerable components
- Component names and versions
- Links to vulnerability information

## Enhanced Report Structure

The enhanced report will include six major sections:

### 1. Executive Summary

- Total websites monitored
- Overall security score/health indicator
- Key metrics at a glance:
  - Websites with vulnerabilities
  - Websites with security events
  - Websites with outdated software
  - Websites with code security issues

### 2. Vulnerabilities (Existing - Enhanced)

**Current**: List of vulnerable components per website
**Enhanced**:

- Prioritize by severity (critical/high/medium/low)
- Show vulnerability age (days since published)
- Group by vulnerability type where possible
- Indicate if vulnerability was introduced this period (new component or new CVE)
- Link to detailed vulnerability information

**Example**:

```
⚠️ CRITICAL VULNERABILITIES (2)

example.com
├─ WooCommerce 8.2.0 → CVE-2023-XXXXX (15 days old)
│  SQL Injection in checkout process
│  Fix: Update to 8.2.2
└─ Contact Form 7 5.7.5 → CVE-2023-YYYYY (45 days old)
   XSS vulnerability in form submissions
   Fix: Update to 5.8.1
```

### 3. Security Events (NEW)

Summary of security events recorded this week, grouped by:

**By Event Type**:

- Failed login attempts: 147 events across 12 websites
- User enumeration: 23 events across 3 websites
- File probes: 8 events across 2 websites

**By Geography**:

- Top 10 countries by event count
- Continental distribution pie chart (data for visualization)

**Notable Patterns**:

- Spike detection: "example.com had 45 failed logins on Dec 4 (3x normal)"
- Persistent attackers: "IP 203.0.113.42 targeted 5 different websites"

**Example**:

```
🔒 SECURITY EVENTS THIS WEEK (178 total)

Event Breakdown:
├─ Failed Login Attempts: 147 events (12 websites)
├─ User Enumeration: 23 events (3 websites)
└─ File Probes: 8 events (2 websites)

Top Attack Sources:
1. China (CN): 78 events
2. Russia (RU): 45 events
3. United States (US): 32 events

⚠️ Notable: example.com had 45 failed logins on Dec 4
```

### 4. Software Versions (NEW)

Status of WordPress core, PHP, and database versions across monitored websites.

**Outdated Software Alert**:

- Websites running end-of-life PHP versions
- Websites behind on WordPress core updates
- Database servers needing updates

**Version Distribution**:

- PHP: 5 sites on 8.1, 12 sites on 8.2, 3 sites on 8.3
- WordPress: 8 sites on 6.4, 10 sites on 6.5, 2 sites on 6.3
- Database: 15 MariaDB, 5 MySQL

**Updates This Week**:

- example.com upgraded WordPress 6.3 → 6.4 ✓
- site2.com upgraded PHP 8.1 → 8.2 ✓

**Example**:

```
💾 SOFTWARE VERSIONS

⚠️ Action Required:
├─ 3 websites on PHP 7.4 (END OF LIFE)
│  └─ oldsite.com, legacy-app.com, test.com
└─ 2 websites on WordPress 6.2 (security updates available)
   └─ example.com, site2.com

✅ Recent Updates:
└─ modernsite.com: WordPress 6.4 → 6.5 (Dec 3)
```

### 5. Code Security Issues (NEW)

Results from static analysis scanning (PHP_CodeSniffer, etc.).

**Summary**:

- Total issues by severity (error/warning/info)
- Issues by category (escape output, nonce verification, etc.)
- Issues trend (up/down from last week)

**Top Issues**:

- Files with most errors
- Most common issue types

**Remediation Guidance**:

- Links to WordPress security documentation
- Code examples for common fixes

**Example**:

```
🔍 STATIC ANALYSIS RESULTS

Issue Summary:
├─ Errors: 15 issues across 8 files
├─ Warnings: 47 issues across 23 files
└─ Info: 12 issues across 9 files

Common Issues:
1. Unescaped Output (23 occurrences)
   Fix: Use esc_html(), esc_attr(), or esc_url()

2. Missing Nonce Verification (15 occurrences)
   Fix: Add wp_verify_nonce() checks

Top Files with Issues:
├─ wp-content/plugins/custom-plugin/admin.php (8 errors)
└─ wp-content/themes/mytheme/functions.php (5 errors)

📖 Remediation Guide: https://vulnz.example.com/docs/security-fixes
```

### 6. Component Changes (NEW)

Audit of plugin/theme additions, removals, and updates.

**Summary**:

- Components added this week
- Components removed this week
- Components updated this week

**Security Context**:

- Alert if newly added component has known vulnerabilities
- Highlight updates that fix security issues

**Example**:

```
🔄 COMPONENT CHANGES THIS WEEK

example.com:
├─ Added: Akismet 5.3.1 ✓
├─ Updated: Yoast SEO 21.5 → 21.6 ✓
└─ Removed: Hello Dolly ✓

⚠️ site2.com:
└─ Added: Contact Form 7 5.7.5 (⚠️ has known vulnerability)
   Action: Update to 5.8.1 immediately

✅ Security Updates Applied:
└─ modernsite.com: WooCommerce 8.2.0 → 8.2.2 (fixes CVE-2023-XXXXX)
```

## Report Customization

### System-Level Configuration

These settings apply to all users and reports:

```bash
# Report frequency (daily, weekly)
REPORT_FREQUENCY=weekly

# Top N items in lists
REPORT_TOP_COUNTRIES=10
REPORT_TOP_FILES_WITH_ISSUES=10

# Severity thresholds
REPORT_SHOW_INFO_ISSUES=false # Only show warnings and errors

# Data included
REPORT_INCLUDE_SECURITY_EVENTS=true
REPORT_INCLUDE_VERSION_STATUS=true
REPORT_INCLUDE_STATIC_ANALYSIS=true
REPORT_INCLUDE_COMPONENT_CHANGES=true
```

### User-Level Preferences (Future Enhancement)

Allow users to customize their reports:

**Potential Options**:

- Report frequency (daily, weekly, monthly)
- Section visibility (enable/disable sections)
- Severity filters (only critical/high vulnerabilities)
- Website filters (only specific websites)
- Delivery format (HTML email, PDF attachment, API webhook)

**Database Schema**:

```sql
ALTER TABLE users ADD COLUMN report_preferences JSON;
```

**Example Preferences**:

```json
{
  "frequency": "weekly",
  "sections": {
    "vulnerabilities": true,
    "security_events": true,
    "versions": false,
    "static_analysis": true,
    "component_changes": true
  },
  "filters": {
    "min_vulnerability_severity": "high",
    "website_ids": [123, 456, 789]
  }
}
```

**Decision**: Start with system-level configuration only. Add user preferences if requested.

## Email Template

### Template Engine

Continue using **Handlebars** (`src/emails/*.hbs`)

### New Templates

- `vulnerability-report.hbs` (existing - will be enhanced)
- Consider splitting into partials:
  - `_vulnerabilities.hbs`
  - `_security-events.hbs`
  - `_versions.hbs`
  - `_static-analysis.hbs`
  - `_component-changes.hbs`

### Template Data Structure

```javascript
{
  user: {
    username: "admin",
    reporting_email: "admin@example.com"
  },
  period: {
    start: "2025-11-29T00:00:00Z",
    end: "2025-12-06T00:00:00Z",
    days: 7
  },
  summary: {
    total_websites: 20,
    websites_with_vulnerabilities: 8,
    websites_with_security_events: 12,
    websites_with_outdated_software: 5,
    websites_with_security_issues: 7
  },
  vulnerabilities: {
    critical: [...],
    high: [...],
    medium: [...],
    low: [...]
  },
  security_events: {
    total: 178,
    by_type: [...],
    by_country: [...],
    notable_patterns: [...]
  },
  versions: {
    outdated_php: [...],
    outdated_wordpress: [...],
    outdated_database: [...],
    recent_updates: [...]
  },
  static_analysis: {
    summary: { errors: 15, warnings: 47, info: 12 },
    by_category: [...],
    top_files: [...],
    remediation_links: [...]
  },
  component_changes: {
    added: [...],
    removed: [...],
    updated: [...],
    security_relevant: [...]
  }
}
```

## Report Generation Process

### Current Process

1. Cron job runs every 10 minutes (`src/lib/cron.js`)
2. Check if it's time to send reports (`reporting.shouldSendReports()`)
3. Get users who need reports (`User.getUsersForReporting()`)
4. Generate and send email for each user
5. Update `users.last_summary_sent_at`

### Enhanced Process

1. Cron job runs every 10 minutes (unchanged)
2. Check if it's time to send reports (unchanged)
3. Get users who need reports (unchanged)
4. **For each user**:
   a. Get user's websites
   b. **Query vulnerabilities** (existing query)
   c. **Query security events** for date range (NEW)
   d. **Query version status** (NEW)
   e. **Query static analysis results** (NEW)
   f. **Query component changes** for date range (NEW)
   g. Compile data structure
   h. Render template
   i. Send email
   j. Update `last_summary_sent_at`

### Performance Considerations

- Use efficient queries with proper indexes
- Consider caching expensive calculations
- Batch database queries where possible
- Set reasonable limits (top 10 countries, not all countries)
- Consider async report generation for users with many websites

### New Queries Required

**Security Events Summary**:

```sql
SELECT
  event_type_id,
  COUNT(*) as count,
  country_code
FROM security_events
WHERE website_id IN (user's websites)
  AND event_datetime >= ?
  AND event_datetime < ?
GROUP BY event_type_id, country_code;
```

**Version Status**:

```sql
SELECT
  domain,
  wordpress_version,
  php_version,
  db_server_type,
  db_server_version
FROM websites
WHERE user_id = ?
  AND (
    wordpress_version < ? OR  -- Outdated WP
    php_version < ? OR        -- Outdated PHP
    db_server_version < ?     -- Outdated DB
  );
```

**Static Analysis Summary**:

```sql
SELECT
  website_id,
  severity,
  issue_type,
  COUNT(*) as count
FROM file_security_issues
WHERE website_id IN (user's websites)
GROUP BY website_id, severity, issue_type;
```

**Component Changes**:

```sql
SELECT
  cc.change_type,
  c.title,
  r_old.version as old_version,
  r_new.version as new_version,
  cc.changed_at
FROM component_changes cc
JOIN components c ON cc.component_id = c.id
LEFT JOIN releases r_old ON cc.old_release_id = r_old.id
LEFT JOIN releases r_new ON cc.new_release_id = r_new.id
WHERE cc.website_id IN (user's websites)
  AND cc.changed_at >= ?
  AND cc.changed_at < ?
ORDER BY cc.changed_at DESC;
```

## Report Delivery

### Email Format

- **HTML** primary format (styled, with colors and icons)
- **Plain text** fallback (for email clients that don't support HTML)

### Email Styling

- Use inline CSS (for email client compatibility)
- Color coding:
  - 🔴 Red: Critical/Error
  - 🟡 Yellow: Warning
  - 🟢 Green: Info/Success
  - 🔵 Blue: Informational

### Subject Line

- `[VULNZ] Weekly Security Report - {period}`
- Example: `[VULNZ] Weekly Security Report - Nov 29 to Dec 6, 2025`

### From Address

- `REPORT_FROM_EMAIL` (e.g., `reports@vulnz.example.com`)
- `REPORT_FROM_NAME` (e.g., `VULNZ Security Reports`)

## Testing & Preview

### Report Preview Endpoint (Future)

Create an endpoint for users to preview their report without waiting for scheduled send:

**GET /api/reports/preview**

- Generate report with current data
- Return HTML for display in browser
- Don't update `last_summary_sent_at`

### Manual Report Trigger (Future)

Allow administrators to manually trigger report generation:

**POST /api/reports/send**

- Force immediate report generation
- Useful for testing or on-demand reports

## Error Handling

### Report Generation Failures

- Log errors to `console.error()` and continue with other users
- Send partial report if some sections fail
- Include error notice in email: "Some sections could not be generated"

### Email Delivery Failures

- Log SMTP errors
- Don't update `last_summary_sent_at` if email fails
- Retry on next cron run

### Data Availability

- Handle missing data gracefully
- Show "No data available" instead of empty sections
- Don't fail entire report if one section has no data

## Future Enhancements

### Interactive Reports

- Host reports on VULNZ web UI
- Allow drill-down into details
- Enable filtering and sorting

### Report Archive

- Store generated reports in database
- Allow users to view past reports
- Enable comparison between periods

### API Webhooks

- POST report data to user-specified webhook URLs
- Enable integration with SIEM systems, Slack, etc.

### Report Scheduling

- Allow users to choose specific day/time for reports
- Support multiple report schedules (daily digest + weekly summary)

### Export Formats

- PDF export for offline storage
- CSV export for data analysis
- JSON API endpoint for programmatic access

## Implementation Priority

**Phase 1** (Initial Implementation):

1. ✅ Enhance report data collection (new queries)
2. ✅ Update Handlebars template with new sections
3. ✅ Test with sample data
4. ✅ Deploy and monitor

**Phase 2** (Near-term Enhancements):

1. Report preview endpoint
2. Manual report trigger
3. Plain text email fallback
4. Error handling improvements

**Phase 3** (Future):

1. User-level preferences
2. Interactive web reports
3. Report archive
4. API webhooks
5. Export formats
