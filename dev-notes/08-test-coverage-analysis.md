# Test Coverage Analysis

## Current Test Status

**Total Tests:** 33 passing  
**Test Files:** 2  
**Test Framework:** Jest 30.2.0  
**Database:** SQLite (in-memory for tests)

## Tested Endpoints ✅

### Settings API (`tests/api/settings.test.js`)

- ✅ GET `/api/settings` - List all settings
- ✅ GET `/api/settings/:key` - Get specific setting
- ✅ PUT `/api/settings/:key` - Update setting (admin only)
- ✅ DELETE `/api/settings/:key` - Delete setting (admin only)

**Coverage:** 21 tests covering:

- Authentication/authorization checks
- Type casting (booleans, numbers, strings)
- Protected system settings
- Admin vs regular user permissions
- Error handling

### Websites API (`tests/api/websites.test.js`)

- ✅ PUT `/api/websites/:domain/versions` - Update version tracking
- ✅ PUT `/api/websites/:domain` - Update website ownership

**Coverage:** 12 tests covering:

- Version updates for WordPress/PHP
- Component version tracking
- Ownership changes
- Backward compatibility (null handling)
- Database integrity

## Untested Routes ⚠️

### Authentication (`src/routes/auth.js`)

**7 endpoints - 0% tested**

- ❌ POST `/api/auth/register` - User registration
- ❌ POST `/api/auth/login` - User login
- ❌ GET `/api/auth/logout` - User logout
- ❌ GET `/api/auth/me` - Get current user
- ❌ POST `/api/auth/reset-password` - Request password reset
- ❌ POST `/api/auth/update-password` - Update password with token
- ❌ GET `/api/auth/validate-token/:token` - Validate reset token

**Priority:** HIGH - Critical security flows

### Users (`src/routes/users.js`)

**13 endpoints - 0% tested**

- ❌ GET `/api/users` - List users (admin)
- ❌ POST `/api/users` - Create user (admin)
- ❌ GET `/api/users/:id` - Get user by ID (admin)
- ❌ PUT `/api/users/me` - Update own profile
- ❌ PUT `/api/users/me/password` - Change own password
- ❌ PUT `/api/users/:id` - Update user (admin)
- ❌ PUT `/api/users/me/pause` - Pause own reports
- ❌ PUT `/api/users/me/unpause` - Resume own reports
- ❌ PUT `/api/users/:id/pause` - Pause user reports (admin)
- ❌ PUT `/api/users/:id/unpause` - Resume user reports (admin)
- ❌ PUT `/api/users/:id/block` - Block user (admin)
- ❌ PUT `/api/users/:id/unblock` - Unblock user (admin)
- ❌ DELETE `/api/users/:id` - Delete user (admin)

**Priority:** HIGH - User management is core functionality

### Components (`src/routes/components.js`)

**9 endpoints - 0% tested**

- ❌ GET `/api/components/search` - Public search (with rate limiting)
- ❌ GET `/api/components` - List all components
- ❌ POST `/api/components` - Create component (admin)
- ❌ POST `/api/components/:type/:slug/:version` - Add release
- ❌ GET `/api/components/:type/:slug/:version` - Get specific release
- ❌ GET `/api/components/:type/:slug` - Get all releases for component
- ❌ GET `/api/components/:id` - Get component by ID
- ❌ PUT `/api/components/:id` - Update component (admin)
- ❌ DELETE `/api/components/:id` - Delete component (admin)

**Priority:** HIGH - Core vulnerability database functionality

### Websites (`src/routes/websites.js`)

**5 endpoints - PARTIALLY tested**

- ✅ PUT `/api/websites/:domain/versions` - Update versions
- ✅ PUT `/api/websites/:domain` - Update website
- ❌ GET `/api/websites` - List websites
- ❌ GET `/api/websites/:domain` - Get website details
- ❌ POST `/api/websites` - Create website
- ❌ DELETE `/api/websites/:domain` - Delete website
- ❌ POST `/api/websites/:domain/security-events` - Add security event
- ❌ POST `/api/websites/:domain/security-scan` - Run security scan

**Priority:** MEDIUM - Core features partially tested, missing CRUD operations

### API Keys (`src/routes/apiKeys.js`)

**3 endpoints - 0% tested**

- ❌ GET `/api/api-keys` - List API keys
- ❌ POST `/api/api-keys` - Create API key
- ❌ DELETE `/api/api-keys/:key` - Delete API key

**Priority:** MEDIUM - Security feature, should be tested

### Roles (`src/routes/roles.js`)

**1 endpoint - 0% tested**

- ❌ GET `/api/roles` - List available roles (admin)

**Priority:** LOW - Simple read-only endpoint

### Component Types (`src/routes/componentTypes.js`)

**1 endpoint - 0% tested**

- ❌ GET `/api/component-types` - List component types

**Priority:** LOW - Simple read-only endpoint

### Logs (`src/routes/logs.js`)

**1 endpoint - 0% tested**

- ❌ GET `/api/logs` - View API call logs

**Priority:** LOW - Admin utility

### Reports (`src/routes/reports.js`)

**1 endpoint - 0% tested**

- ❌ POST `/api/reports/summary-email` - Send test report email

**Priority:** MEDIUM - Email functionality should be tested

### Config (`src/routes/config.js`)

**1 endpoint - 0% tested**

- ❌ GET `/api/config` - Get public configuration

**Priority:** LOW - Simple configuration endpoint

## Coverage Summary

| Route File        | Total Endpoints | Tested | Coverage % | Priority    |
| ----------------- | --------------- | ------ | ---------- | ----------- |
| settings.js       | 4               | 4      | 100%       | ✅ Complete |
| websites.js       | 8               | 2      | 25%        | 🟡 Partial  |
| auth.js           | 7               | 0      | 0%         | 🔴 High     |
| users.js          | 13              | 0      | 0%         | 🔴 High     |
| components.js     | 9               | 0      | 0%         | 🔴 High     |
| apiKeys.js        | 3               | 0      | 0%         | 🟡 Medium   |
| reports.js        | 1               | 0      | 0%         | 🟡 Medium   |
| roles.js          | 1               | 0      | 0%         | 🟢 Low      |
| componentTypes.js | 1               | 0      | 0%         | 🟢 Low      |
| logs.js           | 1               | 0      | 0%         | 🟢 Low      |
| config.js         | 1               | 0      | 0%         | 🟢 Low      |

**Overall API Coverage:** 6/49 endpoints (12%)

## Test Quality Assessment

### Strengths ✅

- **Proper test isolation:** SQLite in-memory database, tests don't affect production
- **Authentication mocking:** Tests properly simulate API key and session auth
- **Comprehensive scenarios:** Settings tests cover type casting, permissions, protected settings
- **Database integrity:** Version update tests verify database state after operations
- **Good structure:** Tests use `beforeAll`/`afterAll` for setup/cleanup

### Weaknesses ⚠️

- **Low coverage:** Only 12% of endpoints tested (6 of 49)
- **Critical gaps:** No authentication flow tests (registration, login, password reset)
- **No error scenarios:** Limited testing of validation failures, malformed requests
- **Missing integration tests:** No tests for complex flows (e.g., full website security scan)
- **No model tests:** Models are only tested indirectly through routes
- **No library tests:** No unit tests for `lib/` utilities (email, sanitizer, versionCompare, etc.)
- **No middleware tests:** No dedicated tests for auth, rate limiting, logging middleware

## Recommended Test Additions

### Priority 1: Authentication & Security

1. **Auth tests** (`tests/api/auth.test.js`)
   - Registration (enabled/disabled)
   - Login success/failure
   - Password reset flow
   - Token validation
   - Session management

2. **User management tests** (`tests/api/users.test.js`)
   - CRUD operations
   - Password changes
   - Profile updates
   - Account status (pause/block)
   - Permission boundaries

3. **API key tests** (`tests/api/apiKeys.test.js`)
   - Key generation
   - Key rotation
   - Key revocation
   - Authentication with keys

### Priority 2: Core Functionality

4. **Component tests** (`tests/api/components.test.js`)
   - Component CRUD
   - Release management
   - Search functionality
   - Version tracking
   - Vulnerability associations

5. **Website tests expansion** (`tests/api/websites.test.js`)
   - Website CRUD operations
   - Security scan flow
   - Security event logging
   - Component detection
   - Report generation

### Priority 3: Libraries & Utilities

6. **Sanitizer tests** (`tests/lib/sanitizer.test.js`)
   - Email validation
   - Version string sanitization
   - URL validation
   - XSS prevention

7. **Version comparison tests** (`tests/lib/versionCompare.test.js`)
   - Semantic versioning
   - Edge cases (rc, beta, alpha)
   - WordPress version formats

8. **Email tests** (`tests/lib/email.test.js`)
   - Template rendering
   - Email sending (mocked)
   - Error handling

### Priority 4: Middleware

9. **Auth middleware tests** (`tests/middleware/auth.test.js`)
   - API key authentication
   - Session authentication
   - Role-based access control
   - Permission checks

10. **Rate limiting tests** (`tests/middleware/rateLimit.test.js`)
    - Request throttling
    - Different limit tiers
    - Reset behavior

## Model Testing Needs

Currently no model unit tests exist. Models should be tested independently:

### High Priority Models

- `models/user.js` - User creation, password hashing, validation
- `models/component.js` - Component lookup, version tracking
- `models/website.js` - Website operations, metadata handling
- `models/vulnerability.js` - Vulnerability data management
- `models/apiKey.js` - Key generation and validation

### Medium Priority Models

- `models/passwordResetToken.js` - Token generation and expiry
- `models/release.js` - Release version handling
- `models/securityEvent.js` - Event logging
- `models/websiteComponent.js` - Component relationships

## Integration Test Opportunities

Complex flows that should be tested end-to-end:

1. **Website Onboarding Flow**
   - Register user → Create website → Run scan → Receive report
2. **Vulnerability Detection Flow**
   - Add component → Add vulnerable release → Scan website → Detect vulnerability
3. **Email Reporting Flow**
   - Website has vulnerabilities → Scheduled report runs → Email sent → Email logged
4. **Password Reset Flow**
   - Request reset → Receive email → Validate token → Update password → Login

## Test Coverage Tools

The project has `npm run test:coverage` configured but it's failing due to Babel/Istanbul compatibility issues with Node v22. Options:

1. **Fix coverage tooling** - Update dependencies to support Node v22
2. **Use built-in coverage** - Switch to Node's built-in coverage (Node 18+)
3. **Manual coverage tracking** - Continue with manual analysis (current approach)

## Testing Best Practices to Maintain

1. **Keep using SQLite for tests** - Fast, isolated, no cleanup needed
2. **Mock external services** - Email sending, GeoIP lookups, external APIs
3. **Test permissions** - Always verify both authorized and unauthorized access
4. **Test validation** - Verify both valid and invalid inputs
5. **Test edge cases** - Null values, empty strings, special characters
6. **Clean test data** - Use factories/helpers for consistent test data creation
7. **Parallel execution** - Tests should be independent and parallelizable

## Conclusion

The existing tests are well-structured with proper isolation and good coverage of the tested areas. However, with only 12% of endpoints covered and no model/library tests, there's significant room for improvement.

**Immediate recommendations:**

1. Add authentication flow tests (registration, login, password reset)
2. Add user management tests (CRUD, permissions)
3. Add component management tests (core functionality)
4. Add model unit tests for critical models (User, Component, Website)
5. Fix or replace test coverage tooling to enable proper metrics

**Long-term goals:**

- Achieve 80%+ route coverage
- Add unit tests for all models
- Add unit tests for library functions
- Create integration tests for complex flows
- Set up coverage thresholds in CI/CD
