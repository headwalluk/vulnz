# Coding Style Guide

This document describes the coding conventions and patterns used in the VULNZ codebase.

---

## General Principles

### Consistency Over Preference

Follow the established patterns in the codebase. When in doubt, look at similar existing code and match the style.

### Avoid Magic Strings and Numbers

**Bad:**
```javascript
if (user.role === 'admin') { ... }
setTimeout(callback, 300000);
```

**Good:**
```javascript
const ROLE_ADMIN = 'administrator';
if (user.role === ROLE_ADMIN) { ... }

const FIVE_MINUTES_MS = 5 * 60 * 1000;
setTimeout(callback, FIVE_MINUTES_MS);
```

### Explicit Over Implicit

Be clear about intent. Avoid clever tricks that obscure what the code does.

---

## JavaScript Style

### Module System

- Use **CommonJS** (`require()` and `module.exports`)
- Node.js v22+ with ES2020 syntax features
- No TypeScript (pure JavaScript)

### Variable Declarations

```javascript
// Use const by default
const userId = req.user.id;

// Use let when reassignment is needed
let count = 0;
count += 1;

// Avoid var
```

### Naming Conventions

```javascript
// camelCase for variables and functions
const userName = 'john';
function getUserById(id) { ... }

// PascalCase for classes and model imports
const User = require('./models/user');
class WebsiteManager { ... }

// UPPER_SNAKE_CASE for constants
const MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_PAGE_SIZE = 20;

// lowercase for files/directories
// Files: user.js, websiteComponent.js
// Dirs: middleware/, lib/
```

### Functions

```javascript
// Prefer async/await over callbacks
async function fetchUser(id) {
  try {
    const user = await User.findById(id);
    return user;
  } catch (err) {
    console.error('Error fetching user:', err);
    throw err;
  }
}

// Arrow functions for simple callbacks
const userIds = users.map((user) => user.id);

// Named functions for exports
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).send('Unauthorized');
}
```

### Error Handling

```javascript
// Always try/catch async operations
async function updateWebsite(id, data) {
  try {
    const result = await Website.update(id, data);
    return result;
  } catch (err) {
    console.error('Failed to update website:', err);
    throw err;
  }
}

// In routes, send appropriate status codes
router.post('/api/websites', async (req, res) => {
  try {
    const website = await Website.create(req.body);
    res.status(201).json(website);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create website');
  }
});
```

### Comments

```javascript
// Single-line comments for brief explanations
// Parse environment variable as integer

/**
 * Multi-line JSDoc for functions exported from modules
 * 
 * @param {number} websiteId - The website ID
 * @param {Object} versions - Version information
 * @returns {Promise<boolean>} - Success status
 */
async function updateVersions(websiteId, versions) { ... }
```

---

## Database Patterns

### Raw SQL with Parameter Binding

```javascript
// Always use parameterized queries (prevents SQL injection)
const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

// For multiple parameters
const results = await db.query(
  'SELECT * FROM websites WHERE user_id = ? AND domain LIKE ?',
  [userId, `%${search}%`]
);

// Never concatenate user input into SQL strings
// BAD: await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

### Model Methods

```javascript
// Models return plain JavaScript objects/arrays
const website = await Website.findByDomain('example.com');
const websites = await Website.findAll(userId, limit, offset);

// Use static methods on models, not instances
// Models in VULNZ are functional, not class-based
```

### Handling Query Results

```javascript
// Query results are arrays
const rows = await db.query('SELECT * FROM users WHERE id = ?', [id]);

// Single row: take first element
const user = rows[0];
if (!user) {
  return res.status(404).send('User not found');
}

// Multiple rows: use directly
const users = await db.query('SELECT * FROM users');
users.forEach(user => { ... });
```

---

## API Routes

### Route Structure

```javascript
const express = require('express');
const router = express.Router();
const { apiOrSessionAuth } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const Website = require('../models/website');

/**
 * @swagger
 * /api/websites:
 *   get:
 *     summary: Retrieve websites
 *     tags:
 *       - Websites
 *     responses:
 *       200:
 *         description: List of websites
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const websites = await Website.findAll(req.user.id);
    res.json(websites);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
```

### Authentication Middleware

```javascript
// API key OR session authentication
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => { ... });

// Session only (web pages)
router.get('/dashboard', isAuthenticatedPage, async (req, res) => { ... });

// Admin only
router.get('/admin/users', apiKeyOrSessionAdminAuth, logApiCall, async (req, res) => { ... });
```

### Request Validation

```javascript
// Validate required fields early
if (!domain || !title) {
  return res.status(400).send('Domain and title are required');
}

// Sanitize user input
const sanitizedDomain = sanitizer.stripAll(domain);
const sanitizedTitle = sanitizer.stripAll(title);
```

### Response Formats

```javascript
// Success with data
res.status(200).json({ websites, total, page });

// Created
res.status(201).json({ id: website.id, domain: website.domain });

// No content
res.status(204).send();

// Errors
res.status(400).send('Invalid input');
res.status(401).send('Unauthorized');
res.status(403).send('Forbidden');
res.status(404).send('Not found');
res.status(500).send('Server error');
```

---

## Frontend (Vanilla JavaScript)

### No Frameworks

- Use vanilla JavaScript (no jQuery in new code)
- Progressive enhancement approach
- Keep JavaScript simple and readable

### DOM Manipulation

```javascript
// Query elements
const form = document.getElementById('login-form');
const button = document.querySelector('.submit-btn');

// Event listeners
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Handle form submission
});

// Creating elements
const div = document.createElement('div');
div.className = 'alert alert-success';
div.textContent = 'Operation successful';
document.body.appendChild(div);
```

### API Calls

```javascript
// Use fetch API
async function fetchWebsites() {
  try {
    const response = await fetch('/api/websites', {
      headers: {
        'X-API-Key': apiKey,
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Failed to fetch websites:', err);
    throw err;
  }
}
```

---

## Testing

### Test Structure

```javascript
describe('Websites API', () => {
  let db;
  let testUser;
  
  beforeAll(async () => {
    db = await createTestDatabase();
    testUser = await createTestUser(db);
  });
  
  afterAll(async () => {
    await cleanupTestDatabase(db);
  });
  
  it('should create a new website', async () => {
    const website = await Website.create({
      user_id: testUser.id,
      domain: 'test.com',
      title: 'Test Site',
    });
    
    expect(website).toBeDefined();
    expect(website.domain).toBe('test.com');
  });
});
```

---

## File Organization

```
src/
  ├── index.js              # Application entry point
  ├── db.js                 # Database connection
  ├── config/               # Configuration (passport, db)
  ├── middleware/           # Express middleware
  ├── models/               # Database models
  ├── routes/               # API routes
  ├── lib/                  # Utility libraries
  ├── migrations/           # Database migrations
  └── emails/               # Email templates (Handlebars)
```

---

## ESLint Configuration

```javascript
// eslint.config.js
module.exports = [
  {
    ignores: ['public/vendor/**', 'dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
    },
    rules: {
      'no-console': 'off', // Allow console.log/error
    },
  },
];
```

Run linting:
```bash
npm run lint
```

---

## Git Commit Messages

```
feat: Add CLI command for user management
fix: Correct pagination calculation in websites API
docs: Update API usage examples
test: Add tests for security event deduplication
refactor: Simplify authentication middleware
chore: Update dependencies to latest versions
```

---

## Summary

The codebase follows a straightforward, maintainable style:
- CommonJS modules
- Async/await for asynchronous operations
- Raw SQL with parameter binding
- Simple, explicit code over clever abstractions
- Security-first approach (input validation, sanitization, parameterized queries)
