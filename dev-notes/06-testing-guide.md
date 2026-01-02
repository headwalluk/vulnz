# Testing Guide

Testing patterns and practices for VULNZ.

---

## Test Status

**Current Coverage**: 114/114 tests passing (10 intentionally skipped)

- ✅ Auth API: 22/22 passing (2 skipped - rate limiting)
- ✅ Components API: 30/30 passing (4 skipped - production behavior differences)
- ✅ Settings API: 21/21 passing
- ✅ Users API: 29/29 passing (4 skipped - production behavior differences)
- ✅ Websites API: 12/12 passing

**Last Updated**: January 2, 2026

---

## Testing Philosophy

- **Authenticity over coverage** - tests must match production behavior exactly
- **Write tests for new features** before merging
- **Integration tests for APIs** - test real workflows
- **Unit tests for utilities** - test pure functions
- **Mock external dependencies** - email, HTTP requests (but NOT database)
- **Use production Passport config** - never mock authentication strategies

---

## Test Structure

```
tests/
  ├── jest.setup.js          # Global test configuration
  ├── setup.js               # Test utilities (createTestUser, etc.)
  ├── README.md              # Testing documentation
  └── api/                   # API integration tests
      ├── auth.test.js
      ├── websites.test.js
      ├── components.test.js
      └── ...
```

---

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- websites.test.js

# Run tests matching pattern
npm test -- --testNamePattern="should create"

# Run with coverage report
npm run test:coverage

# Watch mode (auto-rerun on file changes)
npm run test:watch
```

---

## Test Setup

### jest.setup.js

Global configuration that runs before all tests:

```javascript
// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.SESSION_SECRET = 'test-session-secret';

// Disable features that interfere with tests
process.env.REFERENCE_UPDATE_METHOD = 'disabled';

// Set test database credentials
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';

// Increase timeout for database operations
jest.setTimeout(10000);
```

### setup.js

Test utilities for creating test data:

```javascript
const sqlite3 = require('sqlite3');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Create in-memory SQLite database for testing
async function createTestDatabase() {
  const db = new sqlite3.Database(':memory:');

  // Promisify database methods
  db.query = promisify(db.all).bind(db);
  db.run = promisify(db.run).bind(db);

  return db;
}

// Initialize database schema
async function initializeSchema(db) {
  // Create tables (simplified for SQLite)
  await db.run(`CREATE TABLE users (...)`);
  await db.run(`CREATE TABLE websites (...)`);
  // ... more tables
}

// Create test user
async function createTestUser(db, options = {}) {
  const hashedPassword = await bcrypt.hash(options.password || 'password123', 10);
  const result = await db.run(
    `
    INSERT INTO users (username, email, password) 
    VALUES (?, ?, ?)
  `,
    [options.username || 'testuser', options.email || 'test@example.com', hashedPassword]
  );

  return {
    id: result.lastID,
    username: options.username || 'testuser',
    email: options.email || 'test@example.com',
  };
}

// Create test API key
async function createTestApiKey(db, userId, name = 'Test Key') {
  const apiKey = crypto.randomBytes(32).toString('hex');
  await db.run(
    `
    INSERT INTO api_keys (user_id, api_key, name) 
    VALUES (?, ?, ?)
  `,
    [userId, apiKey, name]
  );

  return { api_key: apiKey, name };
}

// Cleanup test database
async function cleanupTestDatabase(db) {
  if (db) {
    await db.close();
  }
}

module.exports = {
  createTestDatabase,
  initializeSchema,
  createTestUser,
  createTestApiKey,
  cleanupTestDatabase,
};
```

---

## API Integration Tests

### Basic Structure

```javascript
const request = require('supertest');
const express = require('express');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, cleanupTestDatabase } = require('../setup');

// Mock database module
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Mock model dependencies
jest.mock('../../src/models/website');
jest.mock('../../src/models/user');

const Website = require('../../src/models/website');
const User = require('../../src/models/user');

describe('Websites API', () => {
  let app;
  let db;
  let testUser;
  let apiKey;

  beforeAll(async () => {
    // Create test database
    db = await createTestDatabase();

    // Connect mock to test database
    mockDb.query.mockImplementation((...args) => db.query(...args));

    // Initialize schema
    await initializeSchema(db);

    // Create test user and API key
    testUser = await createTestUser(db, {
      username: 'testuser',
      email: 'test@example.com',
    });
    apiKey = await createTestApiKey(db, testUser.id);

    // Setup Express app with routes
    app = express();
    app.use(express.json());
    // ... register routes
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(() => {
    // Clear mock calls between tests
    jest.clearAllMocks();
  });

  it('should create a new website', async () => {
    // Mock model method
    Website.create = jest.fn().mockResolvedValue({
      id: 1,
      domain: 'example.com',
      title: 'Example Site',
      user_id: testUser.id,
    });

    const response = await request(app).post('/api/websites').set('X-API-Key', apiKey.api_key).send({
      domain: 'example.com',
      title: 'Example Site',
    });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.domain).toBe('example.com');
    expect(Website.create).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'example.com',
        title: 'Example Site',
        user_id: testUser.id,
      })
    );
  });

  it('should return 400 when domain is missing', async () => {
    const response = await request(app).post('/api/websites').set('X-API-Key', apiKey.api_key).send({ title: 'No Domain' });

    expect(response.status).toBe(400);
  });

  it('should return 401 when not authenticated', async () => {
    const response = await request(app).get('/api/websites');

    expect(response.status).toBe(401);
  });
});
```

---

## Unit Tests

### Testing Utility Functions

```javascript
const versionCompare = require('../../src/lib/versionCompare');

describe('versionCompare', () => {
  it('should return 0 for equal versions', () => {
    expect(versionCompare('1.2.3', '1.2.3')).toBe(0);
  });

  it('should return -1 when first version is lower', () => {
    expect(versionCompare('1.2.3', '1.2.4')).toBe(-1);
    expect(versionCompare('1.2.3', '2.0.0')).toBe(-1);
  });

  it('should return 1 when first version is higher', () => {
    expect(versionCompare('1.2.4', '1.2.3')).toBe(1);
    expect(versionCompare('2.0.0', '1.2.3')).toBe(1);
  });

  it('should handle versions with different lengths', () => {
    expect(versionCompare('1.2', '1.2.0')).toBe(0);
    expect(versionCompare('1.2.3.4', '1.2.3')).toBe(1);
  });
});
```

### Testing Sanitization

```javascript
const sanitizer = require('../../src/lib/sanitizer');

describe('sanitizer.stripAll', () => {
  it('should strip HTML tags', () => {
    const input = '<p>Hello <strong>World</strong></p>';
    const output = sanitizer.stripAll(input);
    expect(output).toBe('Hello World');
  });

  it('should strip script tags', () => {
    const input = '<script>alert("xss")</script>Hello';
    const output = sanitizer.stripAll(input);
    expect(output).toBe('Hello');
  });

  it('should decode HTML entities', () => {
    const input = '&lt;div&gt;Test&lt;/div&gt;';
    const output = sanitizer.stripAll(input);
    expect(output).toBe('<div>Test</div>');
  });

  it('should strip email addresses', () => {
    const input = 'Contact: user@example.com for help';
    const output = sanitizer.stripAll(input);
    expect(output).toBe('Contact:  for help');
  });
});
```

---

## Mocking Patterns

### Mocking Database

```javascript
// Mock entire db module
jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../../src/db');

// In test:
db.query.mockResolvedValue([{ id: 1, name: 'Test' }]);
```

### Mocking Models

```javascript
jest.mock('../../src/models/user');
const User = require('../../src/models/user');

// Mock specific method
User.findById = jest.fn().mockResolvedValue({
  id: 1,
  username: 'testuser',
  email: 'test@example.com',
});

// Verify call
expect(User.findById).toHaveBeenCalledWith(1);
```

### Mocking External Libraries

```javascript
// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id',
    }),
  }),
}));

const nodemailer = require('nodemailer');

// In test:
const transport = nodemailer.createTransport();
await transport.sendMail({ ... });

expect(transport.sendMail).toHaveBeenCalled();
```

---

## Test Data Factories

Create reusable test data generators:

```javascript
// tests/factories/user.js
const bcrypt = require('bcryptjs');

async function createUser(db, overrides = {}) {
  const defaults = {
    username: `user_${Date.now()}`,
    email: `user_${Date.now()}@example.com`,
    password: 'Password123!',
    blocked: false,
    paused: false,
  };

  const data = { ...defaults, ...overrides };
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const result = await db.run(
    `
    INSERT INTO users (username, email, password, blocked, paused)
    VALUES (?, ?, ?, ?, ?)
  `,
    [data.username, data.email, hashedPassword, data.blocked ? 1 : 0, data.paused ? 1 : 0]
  );

  return {
    id: result.lastID,
    ...data,
    password: hashedPassword,
  };
}

module.exports = { createUser };
```

### Using Factories

```javascript
const { createUser } = require('../factories/user');

it('should block user login when account is blocked', async () => {
  const blockedUser = await createUser(db, { blocked: true });

  const response = await request(app).post('/api/auth/login').send({
    username: blockedUser.username,
    password: 'Password123!',
  });

  expect(response.status).toBe(401);
  expect(response.text).toContain('blocked');
});
```

---

## Testing Async Code

### Promises

```javascript
it('should fetch user by ID', async () => {
  const user = await User.findById(1);
  expect(user).toBeDefined();
  expect(user.id).toBe(1);
});
```

### Error Handling

```javascript
it('should throw error when user not found', async () => {
  await expect(User.findById(999)).rejects.toThrow('User not found');
});
```

### Callbacks (if needed)

```javascript
it('should call callback with result', (done) => {
  fetchUser(1, (err, user) => {
    expect(err).toBeNull();
    expect(user).toBeDefined();
    done();
  });
});
```

---

## Testing Middleware

```javascript
const { isAuthenticated } = require('../../src/middleware/auth');

describe('isAuthenticated middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn(),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    next = jest.fn();
  });

  it('should call next() when user is authenticated', () => {
    req.isAuthenticated.mockReturnValue(true);

    isAuthenticated(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when user is not authenticated', () => {
    req.isAuthenticated.mockReturnValue(false);

    isAuthenticated(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith('Unauthorized');
    expect(next).not.toHaveBeenCalled();
  });
});
```

---

## Coverage Reports

```bash
npm run test:coverage
```

**Output:**

```
-------------------|---------|----------|---------|---------|
File               | % Stmts | % Branch | % Funcs | % Lines |
-------------------|---------|----------|---------|---------|
All files          |   78.5  |   65.2   |   82.1  |   79.3  |
 src/              |   85.2  |   70.1   |   90.0  |   86.0  |
  index.js         |   82.0  |   68.0   |   88.0  |   83.0  |
 src/models/       |   90.0  |   75.0   |   95.0  |   91.0  |
  website.js       |   92.0  |   78.0   |   96.0  |   93.0  |
 src/routes/       |   75.0  |   60.0   |   80.0  |   76.0  |
  websites.js      |   73.0  |   58.0   |   78.0  |   74.0  |
-------------------|---------|----------|---------|---------|
```

**Focus on:**

- Critical paths (authentication, authorization)
- Data validation and sanitization
- Business logic in models
- API routes

**Don't obsess over:**

- 100% coverage (diminishing returns)
- Simple getters/setters
- Configuration files

---

## Test Best Practices

### 1. Descriptive Test Names

```javascript
// ❌ BAD
it('works', () => { ... });

// ✅ GOOD
it('should return 404 when website does not exist', () => { ... });
```

### 2. Arrange-Act-Assert Pattern

```javascript
it('should create a new website', async () => {
  // Arrange: Set up test data
  const websiteData = {
    domain: 'example.com',
    title: 'Example',
  };

  // Act: Perform the action
  const response = await request(app).post('/api/websites').set('X-API-Key', apiKey.api_key).send(websiteData);

  // Assert: Verify the result
  expect(response.status).toBe(201);
  expect(response.body.domain).toBe('example.com');
});
```

### 3. One Assertion Per Test (when practical)

```javascript
// ❌ Testing too many things
it('should handle user operations', async () => {
  const user = await User.create({ ... });
  expect(user).toBeDefined();

  const updated = await User.update(user.id, { ... });
  expect(updated).toBe(true);

  await User.delete(user.id);
  const deleted = await User.findById(user.id);
  expect(deleted).toBeUndefined();
});

// ✅ Separate tests
describe('User model', () => {
  it('should create a new user', async () => { ... });
  it('should update an existing user', async () => { ... });
  it('should delete a user', async () => { ... });
});
```

### 4. Clean Up After Tests

```javascript
afterEach(async () => {
  // Clean up test data
  await db.run('DELETE FROM websites WHERE domain LIKE "test%"');
});

afterAll(async () => {
  // Close database connection
  await cleanupTestDatabase(db);
});
```

### 5. Avoid Test Interdependence

```javascript
// ❌ BAD - Tests depend on order
describe('Websites', () => {
  let websiteId;

  it('should create website', async () => {
    const website = await Website.create({ ... });
    websiteId = website.id; // Shared state
  });

  it('should update website', async () => {
    await Website.update(websiteId, { ... }); // Depends on previous test
  });
});

// ✅ GOOD - Each test is independent
describe('Websites', () => {
  it('should create website', async () => {
    const website = await Website.create({ ... });
    expect(website).toBeDefined();
  });

  it('should update website', async () => {
    const website = await Website.create({ ... }); // Create own test data
    await Website.update(website.id, { ... });
  });
});
```

---

## Debugging Tests

### Run Single Test

```bash
npm test -- --testNamePattern="should create a new website"
```

### Enable Verbose Output

```bash
npm test -- --verbose
```

### Add Debug Logging

```javascript
it('should do something', async () => {
  const result = await someFunction();
  console.log('Result:', JSON.stringify(result, null, 2));
  expect(result).toBeDefined();
});
```

### Use Debugger

```javascript
it('should do something', async () => {
  debugger; // Set breakpoint
  const result = await someFunction();
  expect(result).toBeDefined();
});
```

Then run:

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

---

## Summary

- Use Jest for all testing
- Write integration tests for API endpoints
- Write unit tests for utility functions
- Mock external dependencies
- Aim for good coverage on critical paths
- Keep tests simple and maintainable
- Run tests before every commit
