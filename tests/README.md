# VULNZ Test Suite

Comprehensive API testing infrastructure using Jest and Supertest with in-memory SQLite database isolation.

## Overview

The test suite provides automated testing for all VULNZ API endpoints with a focus on:
- **Authentication**: Verifying API key and session-based authentication
- **Authorization**: Ensuring proper role-based access control (admin vs. regular users)
- **Data integrity**: Testing CRUD operations and type casting
- **Error handling**: Validating error responses for invalid requests

## Architecture

### Test Database Isolation
Tests run against an in-memory SQLite database that is created fresh for each test suite. This provides:
- **Fast execution**: No disk I/O, all operations in memory
- **Clean slate**: Each test suite starts with a pristine database
- **No pollution**: Test data never touches development or production databases
- **Safe credentials**: No risk of leaving test API keys in real databases

### MySQL to SQLite Compatibility Layer
The test setup (`tests/setup.js`) automatically converts MySQL-specific SQL syntax to SQLite equivalents:
- `AUTO_INCREMENT` → `AUTOINCREMENT`
- `ENUM()` → `TEXT`
- `ON DUPLICATE KEY UPDATE` → `ON CONFLICT ... DO UPDATE`
- `INSERT IGNORE` → `INSERT OR IGNORE`
- `TIMESTAMP` → `DATETIME`

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Structure

### Setup (`tests/setup.js`)
Core testing utilities:
- `createTestDatabase()`: Creates in-memory SQLite database
- `initializeSchema()`: Creates all tables and seeds default data
- `createTestUser()`: Creates test users with proper role assignments
- `createTestApiKey()`: Generates API keys for authentication testing
- `createTestWebsite()`: Creates test websites for integration tests
- `cleanupTestDatabase()`: Closes database connections

### Configuration
- `jest.config.js`: Jest configuration with coverage thresholds
- `tests/jest.setup.js`: Environment variables and global test setup

### Test Suites

#### `tests/api/settings.test.js` ✅ 21/21 passing
Comprehensive tests for the Settings API (`/api/settings`):

**GET /api/settings**
- ✓ Authenticated admin can list all settings
- ✓ Authenticated regular user can list all settings
- ✓ Unauthenticated requests are rejected (401)
- ✓ Category filtering works correctly
- ✓ Grouped settings return proper structure

**GET /api/settings/:key**
- ✓ Authenticated users can retrieve single settings
- ✓ Unauthenticated requests are rejected (401)
- ✓ Non-existent settings return 404

**PUT /api/settings/:key** (Admin only)
- ✓ Admin can create new settings
- ✓ Admin can update existing settings
- ✓ Non-admin users are rejected (403)
- ✓ Unauthenticated requests are rejected (401)
- ✓ Invalid type parameters are rejected (400)

**DELETE /api/settings/:key** (Admin only)
- ✓ Admin can delete non-system settings
- ✓ System settings are protected from deletion (403)
- ✓ Non-admin users are rejected (403)
- ✓ Unauthenticated requests are rejected (401)
- ✓ Non-existent settings return 404

**Type Casting**
- ✓ Integer values are cast correctly
- ✓ Boolean values are cast correctly
- ✓ Float values are cast correctly

## Writing New Tests

### Basic Structure

```javascript
const request = require('supertest');
const {
  createTestDatabase,
  initializeSchema,
  createTestUser,
  createTestApiKey,
  cleanupTestDatabase
} = require('../setup');

describe('Your API Feature', () => {
  let app, db, testUser, testApiKey;

  beforeAll(async () => {
    // Create test database and users
    db = await createTestDatabase();
    await initializeSchema(db);
    testUser = await createTestUser(db);
    testApiKey = await createTestApiKey(db, testUser.id);
    
    // Setup Express app with routes
    app = setupYourApp(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('should do something', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .set('X-API-Key', testApiKey.token)
      .expect(200);
      
    expect(response.body).toHaveProperty('data');
  });
});
```

### Testing Authentication

```javascript
// Test with admin user
const adminUser = await createTestUser(db, {
  username: 'admin',
  role: 'admin'
});
const adminApiKey = await createTestApiKey(db, adminUser.id);

// Test with regular user
const regularUser = await createTestUser(db, {
  username: 'user',
  role: 'user'
});
const regularApiKey = await createTestApiKey(db, regularUser.id);

// Admin-only endpoint
await request(app)
  .post('/api/admin-action')
  .set('X-API-Key', adminApiKey.token)
  .expect(200);

await request(app)
  .post('/api/admin-action')
  .set('X-API-Key', regularApiKey.token)
  .expect(403); // Forbidden

// Unauthenticated
await request(app)
  .post('/api/admin-action')
  .expect(401); // Unauthorized
```

## Coverage Goals

Current coverage thresholds (configured in `jest.config.js`):
- **Branches**: 50%
- **Functions**: 50%
- **Lines**: 50%
- **Statements**: 50%

These are baseline targets. Aim for higher coverage in critical paths:
- Authentication/authorization logic: 90%+
- Data validation: 80%+
- Core business logic: 70%+

## Best Practices

### Do
- ✅ Test both success and failure cases
- ✅ Verify authentication and authorization for every endpoint
- ✅ Use descriptive test names that explain what is being tested
- ✅ Clean up test data in `afterAll` or `afterEach` hooks
- ✅ Test edge cases (empty strings, null values, boundary conditions)
- ✅ Use `beforeEach` for test-specific setup that needs to be fresh each time

### Don't
- ❌ Share state between tests (use `beforeEach` not `beforeAll` for mutable data)
- ❌ Make tests dependent on execution order
- ❌ Test implementation details instead of behavior
- ❌ Leave database connections open (always call `cleanupTestDatabase`)
- ❌ Use real credentials or production data in tests
- ❌ Mock everything (test real integrations where practical)

## Troubleshooting

### Tests fail with "Cannot find module"
Install missing dependencies:
```bash
npm install --save-dev jest supertest sqlite3 bcryptjs
```

### Tests fail with "Address already in use"
The test server is trying to use a port that's already taken. Make sure `PORT=0` is set in `tests/jest.setup.js` to use a random available port.

### SQLite syntax errors
Check `tests/setup.js` for MySQL→SQLite conversion rules. Some MySQL features don't have direct SQLite equivalents and may need custom handling.

### Authentication failures in tests
Verify that:
1. Passport strategies are configured in your test setup
2. API keys are properly hashed (SHA-256) before storage
3. User roles are assigned via the `user_roles` junction table

## Future Test Suites

Planned test coverage:
- [ ] `/api/websites` - Website CRUD and validation
- [ ] `/api/users` - User management and roles
- [ ] `/api/plugins` - Plugin vulnerability checks
- [ ] `/api/themes` - Theme vulnerability checks
- [ ] `/api/reports` - Security report generation
- [ ] `/api/security-events` - Security event logging
- [ ] Integration tests for cron jobs
- [ ] E2E tests for complete user workflows

## Contributing

When adding new features:
1. Write tests first (TDD) or immediately after
2. Ensure all existing tests still pass
3. Add tests for edge cases and error conditions
4. Update this README if adding new test utilities
5. Run `npm run test:coverage` to verify coverage hasn't dropped

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Supertest Documentation](https://github.com/visionmedia/supertest)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
