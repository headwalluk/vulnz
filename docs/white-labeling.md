# White-Labeling Feature for Vulnerability Reports

## Overview

This feature enables users to replace the default "vulnz" branding in their weekly vulnerability report emails with custom HTML. This allows service providers and enterprises to maintain their own brand identity in automated security reports.

## Requirements

### User Story
As a VULNZ user, I want to customize the header branding in my weekly vulnerability reports so that my clients see my company's logo and branding instead of the default "vulnz" header.

### Functional Requirements
- All users can enable/disable white-labeling via a checkbox in their account settings
- Users can provide custom HTML (up to 16384 characters / 16 KB) to replace the default header section
- Custom HTML is sanitized to prevent XSS and email client compatibility issues
- When white-labeling is enabled AND custom HTML provided, the custom header is rendered
- When white-labeling is disabled OR no custom HTML provided, no header row is shown (cleaner email)
- Default: White-labeling disabled with empty HTML snippet

### Security Requirements
- **HTML Sanitization**: All user-provided HTML must be sanitized to remove:
  - Script tags and event handlers (XSS prevention)
  - Potentially dangerous attributes
  - External resource loading (unless explicitly allowed)
- **Content Security**: Consider using a library like `sanitize-html` or `DOMPurify`
- **Storage**: HTML snippets stored as TEXT in database (max 16384 characters / 16 KB)
- **Image Hosting**: External image URLs are allowed but discouraged
  - Images hosted on domains different from the sender domain increase spam risk
  - Recommend inline SVG for logos instead of external images
  - Display warning in UI when external images detected (future enhancement)

### UI/UX Requirements
- Checkbox: "Enable custom email header branding"
- Textarea: Large input field for HTML snippet (16384 character limit / 16 KB)
- Character counter: Display remaining characters (e.g., "3500/16384")
- Help text: Provide example HTML showing proper email-safe structure
- Warning: Alert users that external images increase spam risk; recommend inline SVG
- Testing: Users can test their custom header using the existing "Send test email" button in Weekly Reports card

## Database Schema Changes

### New Fields for `users` Table
```sql
ALTER TABLE users ADD COLUMN enable_white_label BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN white_label_html TEXT NULL;
```

**Field Details:**
- `enable_white_label` (BOOLEAN): Toggle for white-labeling feature
  - Default: `FALSE`
  - Not null to ensure explicit enable/disable state
  
- `white_label_html` (TEXT): Custom HTML snippet
  - Nullable: Can be empty when white-labeling is disabled
  - Type TEXT: Supports large HTML content (up to 65,535 bytes)
  - Sanitized before storage

## Email Template Changes

### Implemented Conditional Rendering
```handlebars
{{#if user.enable_white_label}}
  {{#if user.white_label_html}}
    {{{user.white_label_html}}}
  {{/if}}
{{/if}}
```

**Behavior:**
- If `enable_white_label = true` AND `white_label_html` has content: Render custom HTML
- Otherwise: No header row (cleaner, minimal email design)
- Uses triple-braces `{{{ }}}` for unescaped HTML rendering (after sanitization)

## Example Custom HTML Snippets

### Example 1: Simple Logo Header
```html
<tr>
  <td align="center" style="padding: 40px 20px; background-color: #1a237e;">
    <img src="https://example.com/logo.png" alt="Company Logo" style="max-width: 200px; height: auto;">
  </td>
</tr>
```

### Example 2: Text-Based Branding
```html
<tr>
  <td align="center" style="padding: 40px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">ACME Security</h1>
    <p style="margin: 5px 0 0; color: #f0f0f0; font-size: 14px;">Managed WordPress Security</p>
  </td>
</tr>
```

### Example 3: Complex Branded Header
```html
<tr>
  <td align="center" style="padding: 30px 20px; background-color: #ffffff; border-bottom: 3px solid #ff6b6b;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
      <tr>
        <td style="padding-right: 15px;">
          <img src="https://example.com/shield-icon.png" alt="" style="width: 40px; height: 40px;">
        </td>
        <td>
          <h1 style="margin: 0; color: #2d3748; font-size: 24px; font-weight: 700;">SecureWP Pro</h1>
        </td>
      </tr>
    </table>
  </td>
</tr>
```

### Example 4: Inline SVG Logo (Recommended)
```html
<tr>
  <td align="center" style="padding: 40px 20px; background-color: #0f172a;">
    <svg width="120" height="40" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="40" fill="#3b82f6" rx="4"/>
      <text x="60" y="25" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle">YourBrand</text>
    </svg>
    <p style="margin: 10px 0 0; color: #94a3b8; font-size: 12px;">Security Monitoring</p>
  </td>
</tr>
```

## Implementation Checklist

### Phase 1: Database & Model
- [x] Create migration file: `20251221120000-add-white-label-to-users.js`
  - [x] Add `enable_white_label` BOOLEAN column
  - [x] Add `white_label_html` TEXT column
  - [x] Test migration up/down
- [x] Update `src/models/user.js`:
  - [x] Add fields to `createUser()` function signature
  - [x] Add fields to `updateUser()` function
  - [x] Add fields to `getUserById()` and `getUserByUsername()` queries
- [x] Run migration: Auto-runs on server restart with nodemon
- [x] Verify schema changes in database

### Phase 2: HTML Sanitization
- [x] Research sanitization library options:
  - [x] Option 1: `sanitize-html` (Node.js server-side) ✅ **CHOSEN**
  - [x] Option 2: `dompurify` with jsdom (isomorphic)
  - [x] Option 3: Custom regex/parsing (not recommended)
- [x] Install chosen library: `npm install sanitize-html`
- [x] Create utility function: `src/lib/htmlSanitizer.js`
  - [x] Configure allowed tags (table, tr, td, img, h1, p, etc.)
  - [x] Configure allowed attributes (style, src, alt, align, etc.)
  - [x] Configure allowed styles (safe CSS properties)
  - [x] Test with example snippets
- [x] Write unit tests for sanitization edge cases

### Phase 3: API Updates
- [x] Update `PUT /api/users/:id` endpoint:
  - [x] Accept `enable_white_label` in request body
  - [x] Accept `white_label_html` in request body
  - [x] Validate BOOLEAN type for `enable_white_label`
  - [x] Validate max length 4096 characters for `white_label_html`
  - [x] Sanitize `white_label_html` before storage
  - [x] Return appropriate error messages for validation failures
- [x] Update API documentation/Swagger spec
- [x] Test API with curl/Postman:
  - [x] Enable white-label with valid HTML
  - [x] Disable white-label
  - [x] Submit malicious HTML (verify sanitization)
  - [x] Submit empty HTML
  - [x] Submit HTML exceeding 4096 characters (verify rejection)

### Phase 4: Dashboard UI
- [x] Update user settings page (`public/dashboard.html` or equivalent):
  - [x] Add checkbox with label: "Enable custom email header branding"
  - [x] Add textarea with label: "Custom Header HTML" (maxlength="4096")
  - [x] Add character counter below textarea ("X/4096 characters")
  - [x] Add help text with email-safe HTML guidelines
  - [x] Add warning about external images increasing spam risk
  - [x] Add recommendation to use inline SVG
  - [x] Add example snippets (collapsible section with 4 examples)
  - [x] Bind checkbox to show/hide textarea (optional UX enhancement)
- [x] Update JavaScript to handle form submission:
  - [x] Include new fields in PUT request
  - [x] Validate 4096 character limit client-side
  - [x] Update character counter on input
  - [x] Display success/error messages
  - [x] Clear textarea when checkbox is unchecked (optional)
- [x] Add CSS styling for new fields
- [x] Test UI interactions

### Phase 5: Email Template Integration
- [x] Update `src/emails/vulnerability-report.hbs`:
  - [x] Replace lines 45-58 with conditional Handlebars logic
  - [x] Use `{{{triple braces}}}` for unescaped HTML rendering
  - [x] **Simplified approach**: No header when white-label disabled (cleaner)
  - [x] Only show custom header when `enable_white_label = true` AND `white_label_html` has content
- [x] Update `src/lib/email.js`:
  - [x] Ensure user object passed to template includes new fields
  - [x] Verify `getUserById()` in email sending function fetches new columns
- [x] Update `src/lib/reporting.js`:
  - [x] Pass `user` object with white-label fields to email template
- [x] Test email rendering:
  - [x] Send test email with white-label disabled (no header)
  - [x] Send test email with white-label enabled (Example 1)
  - [x] Send test email with white-label enabled (Example 2)
  - [x] Send test email with white-label enabled (Example 4 - inline SVG)

### Phase 6: Testing & Documentation
- [x] Write integration tests:
  - [x] Test user creation with white-label fields
  - [x] Test user update with white-label fields
  - [x] Test email generation with custom HTML
  - [x] Test email generation without custom HTML (no header)
- [x] Test email client compatibility:
  - [x] Gmail (desktop & mobile)
  - [x] Outlook (desktop & web)
  - [x] Apple Mail
  - [x] Thunderbird
- [x] Update user documentation:
  - [x] Add section to `docs/white-labeling.md` explaining feature
  - [x] Include example HTML snippets (4 examples)
  - [x] Include email-safe HTML best practices
  - [x] Include screenshots of UI (via collapsible examples)
- [x] Update CHANGELOG.md:
  - [x] Document new feature under v1.18.0
  - [x] List all changes (DB, API, UI, Email)

### Phase 7: Security Review & Release
- [x] Security review:
  - [x] Verify HTML sanitization prevents XSS
  - [x] Test with various malicious payloads
  - [x] Ensure external resources are handled safely
  - [x] Verify no SQL injection vulnerabilities in new code
- [x] Code review:
  - [x] Review all changes for code quality
  - [x] Ensure proper error handling
  - [x] Verify logging for debugging
- [x] Version bump: Updated to v1.18.0
- [x] Create release notes (in CHANGELOG.md)
- [ ] Deploy to production (ready when you are!)

## Technical Notes

### HTML Sanitization Configuration
When configuring `sanitize-html`, recommended allowed elements for email headers:
```javascript
allowedTags: ['table', 'tr', 'td', 'th', 'img', 'h1', 'h2', 'h3', 'p', 'span', 'div', 'a', 'strong', 'em', 'br'],
allowedAttributes: {
  '*': ['style', 'align', 'valign', 'width', 'height'],
  'img': ['src', 'alt', 'width', 'height'],
  'a': ['href', 'title'],
  'table': ['role', 'cellspacing', 'cellpadding', 'border']
},
allowedStyles: {
  '*': {
    'color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/],
    'background': [/.*/],
    'background-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/],
    'font-size': [/^\d+(?:px|em|%)$/],
    'font-weight': [/^\d+$/, /^bold$/, /^normal$/],
    'text-align': [/^left$/, /^right$/, /^center$/],
    'padding': [/^\d+(?:px|em|%)(?:\s+\d+(?:px|em|%)){0,3}$/],
    'margin': [/^\d+(?:px|em|%)(?:\s+\d+(?:px|em|%)){0,3}$/],
    // Add more as needed for email compatibility
  }
}
```

### Email Client Considerations
- **Inline Styles**: Ensure all styles are inline (no `<style>` tags)
- **Table-Based Layout**: Use `<table>` for layout (not div/flexbox)
- **Image Hosting**: 
  - Images must be hosted on publicly accessible HTTPS URLs
  - **Warning**: Images from external domains increase spam risk
  - **Recommended**: Use inline SVG instead of external images for logos
- **Alt Text**: Always include alt attributes for images
- **Outlook Compatibility**: Test with MSO conditional comments if needed

### Validation Rules
- `enable_white_label`: Must be BOOLEAN (true/false)
- `white_label_html`: 
  - Optional (can be null/empty)
  - Maximum length: 16384 characters / 16 KB (enforced in UI and API)
  - Must pass HTML sanitization
  - Should contain valid email-safe HTML structure
  - Default: Empty string (users must provide their own HTML)

## Future Enhancements

Potential improvements for future versions:
- [ ] Live preview of custom HTML in dashboard
- [ ] Library of pre-designed header templates
- [ ] Support for custom footer branding
- [ ] Upload logo directly (instead of external URL)
- [ ] A/B testing different header styles
- [ ] Per-website white-labeling (instead of per-user)
- [ ] Theme editor with visual customization
- [ ] Automatic detection/warning when external images are present
- [ ] Restrict white-labeling to paid tiers only (monetization)

## Implementation Decisions

**Finalized on December 21, 2025:**

1. **Permissions**: All users can enable/disable white-labeling (may restrict to paid tiers in future)
2. **Storage**: TEXT field with 16384 character limit / 16 KB (sufficient for complex SVG logos)
3. **Validation**: Enforce 16384 character maximum in both UI and API
4. **Default**: Empty HTML snippet (users must provide their own)
5. **External Images**: Allowed, but warn users about spam risk and recommend inline SVG
6. **Versioning**: No version history tracking (keep simple for v1)
7. **Preview**: Use existing "Send test email" button in Weekly Reports card instead of live preview

---

**Created**: December 21, 2025  
**Version**: Specification for v1.18.0  
**Status**: Approved - Ready for implementation
