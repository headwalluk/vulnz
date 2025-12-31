# Account Status Management

**Status:** Planning  
**Date:** 31 December 2025  
**Version:** 1.0

## Overview

This document outlines the implementation of pause/unpause and block/unblock functionality for user accounts. These features provide granular control over account access while maintaining security and preventing administrative lockout scenarios.

## Requirements

### Pause/Unpause Functionality

**Purpose:** Self-service temporary account suspension

- Users can pause and unpause their own accounts via the API (with their own API key)
- Administrators can pause & unpause other user accounts via the API by specifying an alternative user ID
- Administrators can pause & unpause other user accounts via the web UI at `/admin/users`
- Paused users are excluded from scheduled report runners
- Paused users CANNOT log in via the web UI
- Paused users CAN authenticate via API key (to unpause themselves or manage their account)

### Block/Unblock Functionality

**Purpose:** Administrator-imposed hard lockout for security violations or policy enforcement

- Only users with the 'administrator' role can block & unblock user accounts
- Administrators can block/unblock via the API
- Administrators can block/unblock via the web UI at `/admin/users`
- Blocked users are excluded from scheduled report runners
- Blocked users CANNOT log in via the web UI
- Blocked users CANNOT authenticate via API key (complete lockout)
- **Critical:** Administrators CANNOT block their own account (prevent database lockout)

## Security Model

### Account Status Comparison

| Feature                   | Normal | Paused | Blocked |
| ------------------------- | ------ | ------ | ------- |
| UI Login (Local Strategy) | ✅ Yes | ❌ No  | ❌ No   |
| API Key Authentication    | ✅ Yes | ✅ Yes | ❌ No   |
| Scheduled Reports         | ✅ Yes | ❌ No  | ❌ No   |
| Self-Unpause              | N/A    | ✅ Yes | ❌ No   |
| Admin Required to Restore | N/A    | ❌ No  | ✅ Yes  |

### Permission Matrix

| Action                 | User (Self) | User (Others) | Admin (Self) | Admin (Others) |
| ---------------------- | ----------- | ------------- | ------------ | -------------- |
| Pause own account      | ✅ API      | ❌            | ✅ API/UI    | ❌             |
| Unpause own account    | ✅ API      | ❌            | ✅ API/UI    | ❌             |
| Pause other accounts   | ❌          | ❌            | ❌           | ✅ API/UI      |
| Unpause other accounts | ❌          | ❌            | ❌           | ✅ API/UI      |
| Block own account      | ❌          | ❌            | ❌           | ❌             |
| Unblock own account    | ❌          | ❌            | ❌           | ❌             |
| Block other accounts   | ❌          | ❌            | ❌           | ✅ API/UI      |
| Unblock other accounts | ❌          | ❌            | ❌           | ✅ API/UI      |

## Security Considerations

### Identified Risks & Mitigations

1. **Admin Self-Lockout** - Prevented by explicit validation that rejects admin blocking their own account
2. **Session Persistence** - Active sessions remain valid; require re-check on privileged operations
3. **Pause Deadlock** - Paused users retain API key access to unpause themselves
4. **Race Conditions** - Use database transactions for status changes
5. **Audit Trail** - Log all status changes with timestamp, actor, and target user
6. **Phishing Attacks** - Status changes are privileged operations requiring authentication
7. **Account Manipulation** - Only admins can block; pausing is self-service with API key requirement

### Authentication Flow Changes

**Passport Local Strategy (UI Login):**

```
1. Check username exists
2. Check password matches
3. Check NOT blocked
4. Check NOT paused  ← NEW
5. Allow login
```

**Passport API Key Strategy:**

```
1. Check API key exists
2. Check user exists
3. Check NOT blocked
4. Allow authentication (even if paused)  ← UNCHANGED for paused
```

**Scheduled Reports Query:**

```sql
WHERE blocked = 0 AND paused = 0  ← NEW
```

## Implementation Plan

### Phase 1: Database Schema

- [ ] Create migration to add `paused` BOOLEAN column to `users` table (default FALSE)
- [ ] Add index on `paused` column for query performance
- [ ] Test migration up/down

### Phase 2: User Model Updates

- [ ] Update `createTable()` to include `paused` field in schema
- [ ] Update `createUser()` to accept `paused` parameter
- [ ] Update `updateUser()` to handle `paused` parameter
- [ ] Update all SELECT queries to include `paused` field
- [ ] Update `findUsersForWeeklyReport()` to exclude paused users (`AND paused = 0`)
- [ ] Update `countUsersDueForWeeklyReport()` to exclude paused users
- [ ] Add `pauseUser(userId)` helper method
- [ ] Add `unpauseUser(userId)` helper method
- [ ] Export new helper methods

### Phase 3: Authentication & Middleware

- [ ] Update Passport Local Strategy to reject paused users (in addition to blocked)
- [ ] Update `apiOrSessionAuth` middleware to check blocked status for API key auth (keep existing behavior)
- [ ] Update `apiKeyOrSessionAdminAuth` middleware to check blocked status
- [ ] Ensure paused users can still use API keys (no changes needed to HeaderAPIKeyStrategy)
- [ ] Add session validation middleware for UI routes to check paused status

### Phase 4: API Endpoints - Pause/Unpause

- [ ] Add `PUT /api/users/me/pause` endpoint (authenticated user can pause themselves)
- [ ] Add `PUT /api/users/me/unpause` endpoint (authenticated user can unpause themselves)
- [ ] Add `PUT /api/users/:id/pause` endpoint (admin only, validate not pausing self)
- [ ] Add `PUT /api/users/:id/unpause` endpoint (admin only)
- [ ] Add validation to prevent users from pausing others without admin role
- [ ] Add Swagger documentation for new endpoints

### Phase 5: API Endpoints - Block/Unblock

- [ ] Add `PUT /api/users/:id/block` endpoint (admin only)
- [ ] Add `PUT /api/users/:id/unblock` endpoint (admin only)
- [ ] Add validation to prevent admin from blocking themselves (return 403 with clear message)
- [ ] Add validation to prevent non-admins from blocking any users
- [ ] Add Swagger documentation for new endpoints

### Phase 6: Admin UI Updates

- [ ] Update `/public/admin/users.html` to show paused and blocked status badges
- [ ] Add "Pause" button for each user (disabled for current user if not admin viewing others)
- [ ] Add "Unpause" button for paused users
- [ ] Add "Block" button for each user (disabled for current admin's own account)
- [ ] Add "Unblock" button for blocked users
- [ ] Update user list to show visual indicators (icons/badges) for paused/blocked status
- [ ] Add confirmation dialogs for block/unblock actions (more severe than pause)
- [ ] Update `/public/js/admin/users.js` to handle new button actions
- [ ] Update user edit form to show pause/block status (read-only display)
- [ ] Handle API error responses (e.g., admin trying to block themselves)

### Phase 7: User Routes Updates

- [ ] Update `GET /api/users` to include `paused` field in response
- [ ] Update `GET /api/users/:id` to include `paused` field in response
- [ ] Update `POST /api/users` to accept optional `paused` parameter (admin only)
- [ ] Update `PUT /api/users/:id` to prevent non-admins from changing `paused` or `blocked` status
- [ ] Ensure backward compatibility with existing API consumers

### Phase 8: Security & Audit

- [ ] Add audit logging for pause/unpause actions (who, when, target user)
- [ ] Add audit logging for block/unblock actions (who, when, target user)
- [ ] Consider creating `user_status_audit` table for comprehensive tracking
- [ ] Add rate limiting to status change endpoints (prevent abuse)
- [ ] Review all middleware to ensure consistent status checking

### Phase 9: Testing

- [ ] Test paused user cannot log in via UI
- [ ] Test paused user CAN authenticate via API key
- [ ] Test paused user can unpause themselves via API
- [ ] Test blocked user cannot log in via UI
- [ ] Test blocked user CANNOT authenticate via API key
- [ ] Test admin cannot block their own account (API returns 403)
- [ ] Test admin can block other accounts
- [ ] Test admin can pause/unpause other accounts via API
- [ ] Test admin can block/unblock other accounts via UI
- [ ] Test scheduled reports exclude paused users
- [ ] Test scheduled reports exclude blocked users
- [ ] Test non-admin cannot pause other users
- [ ] Test non-admin cannot block any users
- [ ] Test race condition scenarios (concurrent pause/unpause requests)
- [ ] Test session persistence after pause/block

### Phase 10: Documentation & Deployment

- [ ] Update API documentation (if separate from Swagger)
- [ ] Update README with new functionality
- [ ] Add user-facing documentation for pause/unpause feature
- [ ] Add admin documentation for block/unblock feature
- [ ] Update CHANGELOG.md
- [ ] Create deployment notes (migration required)
- [ ] Review all changes with security mindset
- [ ] Code review
- [ ] Lint and format code
- [ ] Deploy to staging
- [ ] QA testing
- [ ] Deploy to production

## Database Schema Changes

### Migration: Add Paused Column

```sql
-- Up
ALTER TABLE users
  ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX paused_idx ON users (paused);

-- Down
DROP INDEX paused_idx ON users;
ALTER TABLE users DROP COLUMN paused;
```

## API Endpoints

### New Endpoints

```
PUT /api/users/me/pause
PUT /api/users/me/unpause
PUT /api/users/:id/pause (admin only)
PUT /api/users/:id/unpause (admin only)
PUT /api/users/:id/block (admin only)
PUT /api/users/:id/unblock (admin only)
```

### Updated Endpoints (Response Changes)

```
GET /api/users (includes paused field)
GET /api/users/:id (includes paused field)
POST /api/users (accepts paused parameter)
```

## UI Changes

### Admin Users Page

**New Visual Indicators:**

- Paused icon/badge next to username
- Blocked icon/badge next to username (different color/style)

**New Action Buttons:**

- Pause/Unpause toggle
- Block/Unblock toggle
- Disabled states for invalid actions (e.g., admin blocking self)

## Notes

- Existing `blocked` field already prevents UI login and is checked in API key auth middleware
- New `paused` field uses same pattern but allows API key access
- Both statuses exclude users from scheduled reports
- Clear separation: `paused` = self-service temporary, `blocked` = admin-imposed permanent
- Admin self-block prevention is critical to avoid complete system lockout
- Consider future enhancements: time-limited pauses, scheduled auto-unpause, email notifications

## Future Enhancements (Out of Scope)

- [ ] Email notification when account is paused by admin
- [ ] Email notification when account is blocked
- [ ] Scheduled auto-unpause after X days
- [ ] Bulk pause/unpause operations
- [ ] Pause/block reason field and display
- [ ] Pause/block history timeline in admin UI
- [ ] Self-service grace period (auto-unpause within X hours)
- [ ] Two-factor authentication requirement for sensitive operations
