# Nice-to-Have Features

Features and enhancements to consider for future development. These are not critical but could add significant value.

**Status**: Ideas & Planning  
**Created**: January 5, 2026  
**Last Updated**: January 5, 2026

---

## Webhook Notifications

**Priority**: Medium  
**Effort**: Medium  
**Value**: High (for power users and integrations)

### Overview

Allow users to receive real-time notifications when vulnerabilities are discovered, instead of (or in addition to) weekly email reports.

### Use Cases

1. **Slack/Discord Integration**: Post vulnerability alerts to team channels
2. **Incident Management**: Trigger PagerDuty/Opsgenie alerts for critical vulnerabilities
3. **Custom Workflows**: Integrate with internal ticketing systems
4. **MSP Dashboards**: Feed data into hosting provider monitoring dashboards

### Proposed Implementation

**Database Schema:**

```sql
CREATE TABLE webhooks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,             -- User-friendly name
  secret VARCHAR(255) NULL,               -- HMAC secret for verification
  events JSON NOT NULL,                   -- ['vulnerability.discovered', 'vulnerability.resolved']
  severity_filter ENUM('all', 'high', 'medium') DEFAULT 'all',
  active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX user_active_idx (user_id, active)
);
```

**API Endpoints:**

```http
POST /api/v2/webhooks
GET /api/v2/webhooks
PUT /api/v2/webhooks/:id
DELETE /api/v2/webhooks/:id
POST /api/v2/webhooks/:id/test  # Send test payload
```

**Payload Format:**

```json
{
  "event": "vulnerability.discovered",
  "timestamp": "2026-01-05T14:30:00Z",
  "user_id": 123,
  "data": {
    "vulnerability": {
      "id": 456,
      "severity": "high",
      "url": "https://osv.dev/vulnerability/CVE-2024-xxxx",
      "component": {
        "slug": "lodash",
        "version": "4.17.20",
        "type": "npm-package",
        "ecosystem": "npm"
      },
      "affected_websites": [
        {
          "id": 789,
          "domain": "example.com",
          "title": "Example Site"
        }
      ]
    }
  },
  "signature": "sha256=..." // HMAC signature for verification
}
```

**Event Types:**

- `vulnerability.discovered` - New vulnerability found
- `vulnerability.resolved` - Vulnerability fixed (component updated)
- `website.added` - New website monitored
- `component.outdated` - Component version is very old (90+ days)

**Implementation Notes:**

- Use job queue (existing or new) for reliable delivery
- Implement retry logic with exponential backoff
- Track delivery status and failures
- Provide webhook logs in UI/CLI
- Validate URLs and test connectivity before activation
- Rate limit webhooks to prevent abuse

**Security Considerations:**

- HMAC signature verification (user provides secret)
- HTTPS-only URLs
- Request timeout (5 seconds max)
- Don't follow redirects
- Validate SSL certificates

**UI/CLI:**

```bash
vulnz webhooks add \
  --url https://hooks.slack.com/services/xxx \
  --name "Team Slack" \
  --events vulnerability.discovered \
  --severity high

vulnz webhooks list
vulnz webhooks test <id>
vulnz webhooks delete <id>
```

**Testing:**

- Test with webhook.site for debugging
- Provide example integrations (Slack, Discord)
- Document common webhook services

---

## Component Acknowledgment

**Priority**: Low-Medium  
**Effort**: Medium  
**Value**: Medium

### Overview

Allow users to acknowledge known vulnerabilities they're working on or have decided to accept the risk for.

### Use Cases

1. **Staging Sites**: Known issues that won't be fixed on staging
2. **Planned Updates**: "We know, it's on our roadmap"
3. **Risk Acceptance**: Low-risk vulnerability in rarely-used component
4. **Reduce Noise**: Stop getting weekly emails about the same issue

### Implementation Ideas

**Database Schema:**

```sql
CREATE TABLE vulnerability_acknowledgments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  website_id BIGINT UNSIGNED NOT NULL,
  vulnerability_id BIGINT UNSIGNED NOT NULL,
  acknowledged_by VARCHAR(255) NULL,      -- Name/email of person
  reason TEXT NULL,                       -- Why acknowledged
  acknowledged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,              -- Optional expiration
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  FOREIGN KEY (vulnerability_id) REFERENCES vulnerabilities(id) ON DELETE CASCADE,
  UNIQUE KEY website_vuln (website_id, vulnerability_id)
);
```

**Behavior:**

- Acknowledged vulnerabilities excluded from weekly reports
- Still visible in dashboard (grayed out or separate section)
- If new vulnerability appears in same component, acknowledgment reset
- Optional expiration date (re-alert after 30/60/90 days)

**Questions:**

- Should acknowledgments be per-website or global for user?
- Should we track who acknowledged (audit trail)?
- Should there be a review process for acknowledged items?

---

## Component Version Age Tracking

**Priority**: Low  
**Effort**: Medium  
**Value**: Medium

### Overview

Track and display how old component versions are, helping users prioritize updates beyond just vulnerabilities.

### Features

- Show release date of installed version
- Show latest available version and its release date
- Highlight components that are 6+ months out of date
- "You're running WordPress 5.8 (released 2 years ago, 15 major versions behind)"

### Data Requirements

- Need release date information from registries
- WordPress.org API provides this
- npm registry provides publish dates
- PyPI provides upload dates

### Implementation

```sql
ALTER TABLE releases
  ADD COLUMN release_date DATE NULL,
  ADD COLUMN is_latest BOOLEAN DEFAULT FALSE;
```

**Reporting:**

```
⏰ Outdated Components:
- WordPress 5.8 (2 years old, 15 versions behind)
- lodash 4.17.20 (3 years old, latest: 4.17.21)
```

---

## Severity-Based Notification Preferences

**Priority**: Medium  
**Effort**: Low (once severity tracking is implemented)  
**Value**: Medium-High

### Overview

Let users customize notification preferences based on vulnerability severity.

### Features

**Per-User Settings:**

```sql
ALTER TABLE users
  ADD COLUMN notify_severity ENUM('all', 'high', 'medium') DEFAULT 'all',
  ADD COLUMN instant_notify_high BOOLEAN DEFAULT FALSE;
```

**Options:**

- Weekly reports: All vulnerabilities | High only | Medium and high
- Instant notifications: Email immediately when high severity found
- Different thresholds for production vs staging sites

**Benefits:**

- Reduces alert fatigue for users with many low-priority sites
- Ensures critical issues get immediate attention
- Flexible notification strategy per user

---

## Multi-Tenancy / Organization Support

**Priority**: Low (Future)  
**Effort**: High  
**Value**: High (for enterprise/MSP use)

### Overview

Allow multiple users within an organization to collaborate on website monitoring.

### Features

- Organizations/Teams table
- Role-based access (admin, member, viewer)
- Share websites across team members
- Unified billing per organization
- Team-wide white-labeling

### Use Cases

- MSPs with multiple technicians
- Agencies with different departments
- Enterprise teams

**Note:** This is a major feature requiring significant planning. Consider for v2.0+

---

## Static Analysis Integration

**Priority**: Low (Future)  
**Effort**: Very High  
**Value**: High (premium feature)

### Overview

Integrate static code analysis to detect security issues beyond known vulnerabilities.

### Potential Features

- File integrity monitoring
- Malware detection
- Code quality issues
- Configuration problems

**Note:** Mentioned in context of vulnerability acknowledgment. Requires significant research and development.

---

## Additional Ideas (Quick Notes)

### Database Backup Monitoring

- Track database backup status
- Alert if backups missing or stale
- Verify backup integrity

### SSL Certificate Expiry Tracking

- Monitor SSL certificate expiration
- Alert 30/14/7 days before expiry
- Track certificate details

### Uptime Monitoring

- Basic uptime checks
- Alert if site goes down
- Track uptime percentage

### Dependency Tree Visualization

- Show component dependency relationships
- Identify which components depend on vulnerable packages
- Visual impact analysis

### Scheduled Scan Reminders

- Email reminders to run scans
- "Your WordPress sites haven't been scanned in 7 days"
- Configurable reminder frequency

### Bulk Operations

- Update multiple websites at once
- Bulk acknowledge vulnerabilities
- Export data in CSV/JSON

### Custom Report Templates

- Let users customize email report format
- Choose which sections to include
- Branding customization beyond white-label HTML

---

## Evaluation Criteria

When considering these features, evaluate:

1. **User Demand**: Have multiple users requested this?
2. **Effort vs Value**: Is the ROI worth it?
3. **Maintenance Burden**: How much ongoing support is needed?
4. **Complexity**: Does it add significant complexity to the system?
5. **Strategic Fit**: Does it align with Vulnz's core mission?

---

## Related Documents

- [00-project-tracker.md](./00-project-tracker.md) - Current roadmap and milestones
- [09-multi-platform-support.md](./09-multi-platform-support.md) - Multi-ecosystem planning
