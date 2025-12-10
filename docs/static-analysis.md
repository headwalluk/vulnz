# Static Analysis Integration

## Overview

Integrate static code analysis results from PHP security scanning tools (like PHP_CodeSniffer with WordPress Security Coding Standards) to identify potential security issues in WordPress core files, plugins, and themes.

## Goals

- Store security issues detected by static analysis tools
- Track issues at the file and line level
- Support automatic cleanup of resolved issues
- Provide sample scanning script for hosting providers
- Include security findings in weekly reports

## Data Ingestion

The website hosting provider is responsible for running static analysis tools and POSTing results to the VULNZ API.

**VULNZ Provides**:

- Sample BASH script using PHP_CodeSniffer with WordPress Security sniffs
- Script will be located in `scripts/scan-website.sh`
- API endpoint documentation for submitting results

**Provider Integrates**:

- Run scanning on their schedule (e.g., daily, weekly)
- Parse scanner output into JSON format
- POST results to VULNZ API

## Sample Scanner Script

A reference implementation will be provided at `scripts/scan-website.sh`:

```bash
#!/bin/bash
# Sample static analysis scanner for WordPress websites
# Requires: PHP_CodeSniffer, WordPress Coding Standards, WordPress Security Coding Standards

WEBSITE_PATH=$1
VULNZ_API_URL=$2
VULNZ_API_KEY=$3
WEBSITE_ID=$4

if [ -z "$WEBSITE_PATH" ] || [ -z "$VULNZ_API_URL" ] || [ -z "$VULNZ_API_KEY" ] || [ -z "$WEBSITE_ID" ]; then
  echo "Usage: $0 <website_path> <vulnz_api_url> <vulnz_api_key> <website_id>"
  exit 1
fi

# Run phpcs with WordPress Security standards
phpcs --standard=WordPress-Security \
  --report=json \
  --extensions=php \
  "$WEBSITE_PATH" > /tmp/phpcs-report.json

# Parse and POST to VULNZ API
# (Node.js/Python script to parse JSON and POST to API)
node scripts/post-analysis-results.js \
  "$VULNZ_API_URL" \
  "$VULNZ_API_KEY" \
  "$WEBSITE_ID" \
  /tmp/phpcs-report.json

rm /tmp/phpcs-report.json
```

**Note**: This is a sample implementation. Providers can adapt it or build their own scanning solution.

## Static Analysis Tools

**Recommended**:

- PHP_CodeSniffer with WordPress Coding Standards
- WordPress Security Coding Standards (https://github.com/WordPress/WordPress-Coding-Standards)
- Specific sniffs for security issues

**Other Compatible Tools**:

- Psalm with security plugins
- PHPStan with security rules
- Custom scanning scripts

**Tool-Agnostic Design**: The API accepts a standardized format regardless of scanner used.

## Data Model

### `file_security_issues` Table

Tracks security issues found in specific files, with touch-based purging for resolved issues.

**Schema**:

```sql
CREATE TABLE file_security_issues (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  website_id INT UNSIGNED NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  line_number INT UNSIGNED,
  issue_type VARCHAR(100) NOT NULL,
  severity ENUM('info', 'warning', 'error') DEFAULT 'warning',
  message TEXT,
  last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,

  INDEX idx_website_file (website_id, file_path),
  INDEX idx_severity (severity),
  INDEX idx_last_seen (last_seen_at)
);
```

**Field Descriptions**:

- `file_path`: Relative path from WordPress root (e.g., `wp-content/plugins/myplugin/admin.php`)
- `line_number`: Line where issue was found (NULL for file-level issues)
- `issue_type`: Scanner-specific code (e.g., `WordPress.Security.EscapeOutput.OutputNotEscaped`)
- `severity`: Issue severity level
- `message`: Human-readable description of the issue
- `last_seen_at`: Updated each time the issue is still present in a scan

## Data Retention & Cleanup

Static analysis issues use a "touch-based" purging strategy similar to the websites model:

### Automatic Cleanup Rules

1. **Resolved Issues**: If a file is scanned and has zero issues, any existing records for that file are deleted immediately.

2. **Stale Issues**: If a file's issues aren't "touched" (re-reported) within X days, they are purged.

3. **Deleted Files**: If a file no longer exists (not in scan results for X days), its issues are purged.

**Configuration**:

```bash
FILE_SECURITY_ISSUES_RETENTION_DAYS=30 # Default: 30 days
```

**Implementation**:

- `FileSecurityIssue.removeStaleIssues()` static method
- Called by cron job daily
- Deletes issues where `last_seen_at` older than retention period

### API Behavior

When a scan is POSTed:

1. **Issues Found**: Create new records or update `last_seen_at` on existing records
2. **Zero Issues for File**: Delete all records for that file path
3. **File Not in Scan**: No action (wait for retention period to purge)

This ensures:

- Fixed issues are removed promptly
- Persistent issues stay in the database
- Deleted files eventually get cleaned up

## API Endpoints

### POST /api/websites/:id/security-scan

Submit static analysis results for a website.

**Authentication**: API key or session with access to the website

**Request Body**:

```json
{
  "scan_datetime": "2025-12-06T15:30:00Z",
  "scanner": "phpcs-wordpress-security",
  "scanner_version": "3.7.2",
  "files": [
    {
      "path": "wp-content/plugins/myplugin/admin.php",
      "issues": [
        {
          "line": 42,
          "type": "WordPress.Security.EscapeOutput.OutputNotEscaped",
          "severity": "error",
          "message": "All output should be run through an escaping function"
        },
        {
          "line": 58,
          "type": "WordPress.Security.NonceVerification.Missing",
          "severity": "warning",
          "message": "Processing form data without nonce verification"
        }
      ]
    },
    {
      "path": "wp-content/themes/mytheme/functions.php",
      "issues": []
    }
  ]
}
```

**Response**: `201 Created` with summary:

```json
{
  "processed": 2,
  "issues_created": 2,
  "issues_updated": 0,
  "issues_deleted": 5,
  "summary": {
    "error": 1,
    "warning": 1,
    "info": 0
  }
}
```

**Processing Logic**:

1. For each file with issues:
   - Insert new issues or update `last_seen_at` on existing
2. For each file with zero issues:
   - Delete existing records for that file path
3. Return summary of database changes

### GET /api/websites/:id/security-issues

Retrieve current security issues for a website (future enhancement, low priority).

**Query Parameters**:

- `severity` - Filter by severity level
- `file_path` - Filter by file path (supports wildcards)
- `limit` - Max results (default: 100)

**Response**:

```json
{
  "issues": [
    {
      "id": 123,
      "file_path": "wp-content/plugins/myplugin/admin.php",
      "line_number": 42,
      "issue_type": "WordPress.Security.EscapeOutput.OutputNotEscaped",
      "severity": "error",
      "message": "All output should be run through an escaping function",
      "last_seen_at": "2025-12-06T15:30:00Z",
      "created_at": "2025-11-15T10:00:00Z"
    }
  ],
  "summary": {
    "total": 15,
    "error": 3,
    "warning": 10,
    "info": 2
  }
}
```

## Reporting Integration

Security issues will be included in weekly vulnerability reports.

**Report Sections**:

1. **Security Issues Summary**
   - Total issues by severity
   - Issues by category (escape output, nonce verification, SQL injection, etc.)
   - Trend: issues added/resolved since last report

2. **Top Files with Issues**
   - Files with most errors
   - Recently added files with issues

3. **Remediation Guidance**
   - Issue type explanations
   - Links to WordPress security documentation
   - Code examples for common fixes

4. **Progress Tracking**
   - "5 issues resolved since last week"
   - "3 new issues detected"
   - Overall security score trend

## Issue Categorization

Common WordPress security issue types:

**Escape Output** (`WordPress.Security.EscapeOutput.*`):

- Unescaped output vulnerabilities (XSS)

**Nonce Verification** (`WordPress.Security.NonceVerification.*`):

- Missing CSRF protection

**Safe Redirect** (`WordPress.Security.SafeRedirect`):

- Unsafe URL redirects

**Validated Sanitized Input** (`WordPress.Security.ValidatedSanitizedInput.*`):

- Unsanitized user input (SQL injection, etc.)

**Plugin Menu Slug** (`WordPress.Security.PluginMenuSlug`):

- Insecure menu slugs

Reports can group by these categories for clarity.

## Sample Scanner Installation

The sample script requires PHP_CodeSniffer and WordPress standards:

```bash
# Install PHP_CodeSniffer
composer global require "squizlabs/php_codesniffer=*"

# Install WordPress Coding Standards
composer global require wp-coding-standards/wpcs

# Register standards
phpcs --config-set installed_paths ~/.composer/vendor/wp-coding-standards/wpcs

# Verify installation
phpcs -i # Should show WordPress, WordPress-Core, WordPress-Docs, WordPress-Extra, etc.
```

Documentation will be included in `docs/static-analysis.md` with detailed setup instructions.

## Implementation Notes

- Bulk insert/update for performance (single transaction per scan)
- Consider file path normalization (remove `./`, resolve symlinks)
- Handle large scan results (paginate or stream if needed)
- Scanner version tracking helps debug false positives
- Issue type enumeration could be added later for consistency
- Consider severity mapping if different scanners use different scales

## Future Enhancements

- **Issue Suppression**: Allow administrators to mark false positives
- **Custom Rules**: Support custom PHPCS rulesets per website
- **Incremental Scanning**: Only scan changed files
- **Historical Trending**: Track issue counts over time
- **Integration with Git**: Link issues to specific commits
