# Future Development Ideas

This document captures potential features and improvements for future releases of VULNZ.

## UI Modernization

### Current State

The current UI is built with server-rendered HTML, Bootstrap 5, and jQuery. While functional, it's reaching its limits as features become more complex:

- Manual DOM manipulation is becoming unwieldy
- No client-side state management
- Page refreshes required for most operations
- Limited real-time updates
- Difficult to build complex interactive features

### Proposed: Modern Single-Page Application (SPA)

**Benefits:**

- Better user experience with instant navigation
- Real-time updates without page refreshes
- More sophisticated UI components
- Better state management
- Improved maintainability
- Component reusability

**Technology Options:**

1. **React + Vite**
   - Most popular, huge ecosystem
   - Great component libraries (Material-UI, Ant Design, shadcn/ui)
   - Good TypeScript support
   - Fast development with Vite

2. **Vue 3 + Vite**
   - Easier learning curve
   - Excellent documentation
   - Built-in state management (Pinia)
   - Good TypeScript support

3. **Svelte/SvelteKit**
   - Smallest bundle sizes
   - Less boilerplate code
   - Excellent developer experience
   - Compile-time framework (no virtual DOM)

**Implementation Approach:**

Option A: **Big Bang Migration**

- Build entire new UI from scratch
- Switch over when feature-complete
- Pros: Clean slate, no technical debt
- Cons: Long development time, feature parity challenges

Option B: **Incremental Migration**

- Keep existing UI as default
- Build new SPA at `/app/*` route
- Migrate pages one at a time
- Eventually deprecate old UI
- Pros: Continuous delivery, lower risk
- Cons: Maintaining two UIs temporarily

Option C: **Hybrid Approach**

- Keep simple pages (login, settings) as server-rendered
- Convert complex pages (dashboard, admin) to SPA
- Best of both worlds for different use cases
- Pros: Pragmatic, faster to value
- Cons: More complex routing/auth

**Key Considerations:**

- Authentication: JWT tokens vs session-based (currently session-based)
- API-first: Ensure all functionality available via REST API (mostly done)
- Real-time: Consider WebSocket support for live updates
- Build process: Separate frontend build pipeline
- Deployment: Static assets served by Express or CDN
- SEO: Not a concern for this authenticated admin tool

**Recommended Path:**
Incremental migration (Option B) starting with the dashboard page. This provides immediate value while reducing risk. The solid REST API already exists, making this feasible.

---

## Feature Roadmap

### High Priority (Next Release Candidates)

#### 1. Audit Logging for Ownership Changes

**Problem:** No accountability for who changed website ownership
**Solution:** Track administrative actions in audit log

Implementation:

- New table: `website_audit_log`
  - `id`, `website_id`, `changed_by_user_id`, `action` (transferred, deleted, etc.)
  - `old_value`, `new_value`, `changed_at`, `ip_address`
- Log on ownership transfer, website deletion, bulk operations
- Admin page to view audit history
- Filter by website, user, action type, date range

**Effort:** Low (1-2 hours)
**Value:** High (governance, compliance, troubleshooting)

#### 2. Bulk Website Operations

**Problem:** Admins must change ownership one website at a time
**Solution:** Checkbox selection + bulk actions

Implementation:

- Add checkboxes to website table rows
- "Select All" / "Select Filtered" options
- Bulk actions dropdown:
  - Transfer to user (shows user selector)
  - Delete selected
  - Export to CSV
- Confirmation modal showing impact
- API endpoint: `POST /api/websites/bulk` with `action` and `website_ids[]`

**Effort:** Medium (3-4 hours)
**Value:** High (productivity for admins managing many sites)

#### 3. Dashboard Filtering Enhancements

**Problem:** Limited filtering on dashboard
**Solution:** Additional filter controls

Implementation:

- Owner filter (admin only) - dropdown populated from `/api/users`
- Version filters - WordPress < X, PHP < Y
- Last updated filter - not updated in X days
- Use query params for shareable filtered URLs
- "Save filter" functionality (localStorage)

**Effort:** Low-Medium (2-3 hours)
**Value:** Medium (improved navigation for large deployments)

### Medium Priority

#### 4. User Management Page Improvements

**Current State:** Basic user list/edit
**Enhancements:**

- Show website count per user in table
- "View websites" link → dashboard filtered by user
- Total component count per user
- Last login/activity timestamp
- Quick "impersonate user" for troubleshooting (admin only)

**Effort:** Low (1-2 hours)
**Value:** Medium (better admin oversight)

#### 5. Replace alert() with Bootstrap Modals

**Problem:** Browser alerts are dated and non-customizable
**Solution:** Consistent modal confirmations

Implementation:

- Create reusable confirmation modal component
- Replace all `alert()` and `confirm()` calls
- Support for custom buttons, icons, actions
- Better accessibility

**Effort:** Low (1-2 hours)
**Value:** Medium (better UX, more professional)

#### 6. Activity Summary Dashboard

**Features:**

- Total websites, users, components tracked
- Websites added/removed this week
- Top vulnerabilities discovered
- Most active users
- Version distribution charts
- Recent component changes feed

**Effort:** Medium (4-6 hours)
**Value:** Medium (visibility into system usage)

### Lower Priority / Future Exploration

#### 7. API Key Scoping

Allow API keys to be restricted to specific websites or permissions.

**Use Case:** Give clients read-only access to their websites only

**Implementation:**

- Add `scope` JSON field to `api_keys` table
- Scope types: `all`, `websites:[ids]`, `permissions:[read,write]`
- Middleware to validate scope on requests
- UI to configure scope when creating/editing keys

**Effort:** Medium-High (6-8 hours)
**Value:** Medium (security, multi-tenancy)

#### 8. Website Tags/Labels

Categorize websites with custom tags for organization.

**Examples:** "Production", "Staging", "Client: Acme Corp", "High Priority"

**Implementation:**

- New table: `website_tags` with many-to-many relationship
- Tag CRUD API
- Filter dashboard by tag
- Bulk tag assignment
- Color coding in UI

**Effort:** Medium (4-5 hours)
**Value:** Low-Medium (organizational tool)

#### 9. Per-Website Report Scheduling

Override global weekly schedule with per-website settings.

**Use Case:** Critical sites need daily reports, staging sites weekly

**Implementation:**

- Add `reporting_schedule` to websites table (JSON)
- Override user's default schedule if set
- UI to configure per-website
- Cron job respects both user and website schedules

**Effort:** Medium-High (6-8 hours)
**Value:** Low-Medium (niche use case)

#### 10. Component Change Notifications

Real-time alerts when components change.

**Features:**

- Email/webhook when plugin updated
- Slack integration
- Configurable rules (only notify on security updates)
- Digest mode vs real-time

**Effort:** High (8-12 hours)
**Value:** Medium (proactive monitoring)

#### 11. Custom Report Templates

Allow users to customize report content/branding per-client.

**Features:**

- Handlebars template editor
- Per-user or per-website templates
- Section visibility toggles
- Custom branding (logo, colors)
- Preview mode

**Effort:** High (10-15 hours)
**Value:** Medium (white-labeling for agencies)

---

## Technical Debt / Maintenance

### Testing

- Increase test coverage (currently 2 test files, 33 tests)
- Add integration tests for API workflows
- Frontend testing (if SPA is built - Jest/Vitest + Testing Library)
- E2E tests (Playwright/Cypress) for critical paths

### Performance

- Database indexing review (especially for large deployments)
- Query optimization (N+1 queries in website list?)
- Caching strategy (Redis for frequently accessed data)
- API response pagination improvements

### Code Quality

- TypeScript migration (backend and/or frontend)
- API documentation improvements (expand Swagger docs)
- Centralized error handling
- Consistent validation approach

### Security

- Rate limiting per user (currently global)
- CSP headers configuration
- Dependency scanning automation
- Security headers audit

---

## Notes

This document should be reviewed quarterly and updated based on:

- User feedback and feature requests
- Usage patterns and pain points
- Technical landscape changes
- Resource availability

Last Updated: 2025-12-14
