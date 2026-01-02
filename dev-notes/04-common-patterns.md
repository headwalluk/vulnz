# Common Patterns

How to add and modify features in VULNZ.

---

## Adding a New Model

Models handle database operations for a specific table.

### 1. Create the Model File

**File**: `src/models/example.js`

```javascript
const db = require('../db');

const createTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS examples (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `;
  await db.query(query);
};

const findAll = async (userId) => {
  const rows = await db.query('SELECT * FROM examples WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  return Array.isArray(rows) ? rows : [];
};

const findById = async (id) => {
  const rows = await db.query('SELECT * FROM examples WHERE id = ?', [id]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
};

const create = async (example) => {
  const { user_id, name, description } = example;
  const result = await db.query('INSERT INTO examples (user_id, name, description) VALUES (?, ?, ?)', [user_id, name, description]);
  const insertId = result.insertId || result[0]?.insertId;
  return { id: insertId, ...example };
};

const update = async (id, data) => {
  const fields = Object.keys(data);
  const values = Object.values(data);

  if (fields.length === 0) {
    return false;
  }

  const setClause = fields.map((field) => `${field} = ?`).join(', ');
  const query = `UPDATE examples SET ${setClause} WHERE id = ?`;
  const params = [...values, id];

  await db.query(query, params);
  return true;
};

const remove = async (id) => {
  await db.query('DELETE FROM examples WHERE id = ?', [id]);
  return true;
};

module.exports = {
  createTable,
  findAll,
  findById,
  create,
  update,
  remove,
};
```

### 2. Import in index.js

**File**: `src/index.js`

```javascript
// Add with other model imports
const example = require('./models/example');

// Initialize table (call createTable during startup)
await example.createTable();
```

### 3. Create Migration (Recommended)

**File**: `src/migrations/20260102120000-create-examples-table.js`

```javascript
const db = require('../db');

async function up() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS examples (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

module.exports = { up };
```

---

## Adding a New API Route

### 1. Create Route File

**File**: `src/routes/examples.js`

```javascript
const express = require('express');
const router = express.Router();
const Example = require('../models/example');
const { apiOrSessionAuth, hasRole } = require('../middleware/auth');
const { logApiCall } = require('../middleware/logApiCall');
const sanitizer = require('../lib/sanitizer');

/**
 * @swagger
 * /api/examples:
 *   get:
 *     summary: Get all examples for the authenticated user
 *     tags:
 *       - Examples
 *     responses:
 *       200:
 *         description: List of examples
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 */
router.get('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const examples = await Example.findAll(req.user.id);
    res.json(examples);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/examples/{id}:
 *   get:
 *     summary: Get a specific example by ID
 *     tags:
 *       - Examples
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/:id', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const example = await Example.findById(req.params.id);

    if (!example) {
      return res.status(404).send('Example not found');
    }

    // Check ownership or admin role
    const roles = await User.getRoles(req.user.id);
    if (example.user_id !== req.user.id && !roles.includes('administrator')) {
      return res.status(403).send('Forbidden');
    }

    res.json(example);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/examples:
 *   post:
 *     summary: Create a new example
 *     tags:
 *       - Examples
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 */
router.post('/', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const { name, description } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).send('Name is required');
    }

    // Sanitize input
    const sanitizedName = sanitizer.stripAll(name);
    const sanitizedDescription = description ? sanitizer.stripAll(description) : null;

    // Create example
    const example = await Example.create({
      user_id: req.user.id,
      name: sanitizedName,
      description: sanitizedDescription,
    });

    res.status(201).json(example);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/examples/{id}:
 *   put:
 *     summary: Update an existing example
 *     tags:
 *       - Examples
 */
router.put('/:id', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const example = await Example.findById(req.params.id);

    if (!example) {
      return res.status(404).send('Example not found');
    }

    // Check ownership
    if (example.user_id !== req.user.id) {
      const roles = await User.getRoles(req.user.id);
      if (!roles.includes('administrator')) {
        return res.status(403).send('Forbidden');
      }
    }

    // Build update object
    const updates = {};
    if (req.body.name) {
      updates.name = sanitizer.stripAll(req.body.name);
    }
    if (req.body.description !== undefined) {
      updates.description = req.body.description ? sanitizer.stripAll(req.body.description) : null;
    }

    await Example.update(req.params.id, updates);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

/**
 * @swagger
 * /api/examples/{id}:
 *   delete:
 *     summary: Delete an example
 *     tags:
 *       - Examples
 */
router.delete('/:id', apiOrSessionAuth, logApiCall, async (req, res) => {
  try {
    const example = await Example.findById(req.params.id);

    if (!example) {
      return res.status(404).send('Example not found');
    }

    // Check ownership or admin
    if (example.user_id !== req.user.id) {
      const roles = await User.getRoles(req.user.id);
      if (!roles.includes('administrator')) {
        return res.status(403).send('Forbidden');
      }
    }

    await Example.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
```

### 2. Register Route in index.js

**File**: `src/index.js`

```javascript
// Import route
const exampleRoutes = require('./routes/examples');

// Register route (after other API routes)
app.use('/api/examples', exampleRoutes);
```

---

## Adding a New Email Template

### 1. Create Handlebars Template

**File**: `src/emails/example-notification.hbs`

```handlebars
<html>
  <head>
    <meta charset='UTF-8' />
    <meta name='viewport' content='width=device-width, initial-scale=1.0' />
    <title>{{subject}}</title>
  </head>
  <body style='font-family: Arial, sans-serif; line-height: 1.6; color: #333;'>
    <table width='100%' cellpadding='0' cellspacing='0'>
      {{#if whiteLabel}}
        <tr>
          <td>{{{whiteLabel}}}</td>
        </tr>
      {{/if}}

      <tr>
        <td style='padding: 20px;'>
          <h1>{{title}}</h1>
          <p>Hello {{userName}},</p>
          <p>{{message}}</p>

          {{#if actionUrl}}
            <p>
              <a href='{{actionUrl}}' style='background: #007bff; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;'>
                {{actionText}}
              </a>
            </p>
          {{/if}}

          <p>Thank you!</p>
        </td>
      </tr>

      <tr>
        <td style='padding: 20px; background: #f8f9fa; text-align: center; font-size: 12px; color: #666;'>
          <p>This email was sent from VULNZ</p>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### 2. Send Email

```javascript
const { sendEmail } = require('./lib/email');

async function sendExampleNotification(user, data) {
  const template = 'example-notification';
  const subject = 'Example Notification';

  const templateData = {
    subject,
    userName: user.username,
    title: 'Important Update',
    message: data.message,
    actionUrl: data.url,
    actionText: 'View Details',
    whiteLabel: user.enable_white_label ? user.white_label_html : null,
  };

  await sendEmail(user.email, subject, template, templateData, user.id, 'example-notification');
}
```

---

## Adding a Scheduled Task

**File**: `src/index.js`

```javascript
const cron = require('node-cron');

// Run every day at 2:00 AM
cron.schedule('0 2 * * *', async () => {
  console.log('Running daily cleanup task');
  try {
    // Perform task
    await cleanupOldData();
  } catch (err) {
    console.error('Daily cleanup failed:', err);
  }
});

// Run every hour at :30
cron.schedule('30 * * * *', async () => {
  console.log('Running hourly sync task');
  try {
    await syncExternalData();
  } catch (err) {
    console.error('Hourly sync failed:', err);
  }
});
```

**Cron Syntax:**

```
┌─────────── minute (0 - 59)
│ ┌───────── hour (0 - 23)
│ │ ┌─────── day of month (1 - 31)
│ │ │ ┌───── month (1 - 12)
│ │ │ │ ┌─── day of week (0 - 6, Sunday = 0)
│ │ │ │ │
* * * * *
```

**Examples:**

- `0 0 * * *` - Daily at midnight
- `0 */6 * * *` - Every 6 hours
- `*/15 * * * *` - Every 15 minutes
- `0 9 * * 1` - Every Monday at 9 AM

---

## Adding Middleware

### 1. Create Middleware File

**File**: `src/middleware/validateInput.js`

```javascript
function validateDomain(req, res, next) {
  const { domain } = req.body;

  if (!domain) {
    return res.status(400).send('Domain is required');
  }

  // Basic domain validation
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  if (!domainRegex.test(domain)) {
    return res.status(400).send('Invalid domain format');
  }

  next();
}

module.exports = { validateDomain };
```

### 2. Use Middleware in Route

```javascript
const { validateDomain } = require('../middleware/validateInput');

router.post('/api/websites', apiOrSessionAuth, validateDomain, logApiCall, async (req, res) => {
  // Domain is already validated
  const website = await Website.create(req.body);
  res.status(201).json(website);
});
```

---

## Adding a Utility Function

**File**: `src/lib/utils.js`

```javascript
/**
 * Format a date for display
 * @param {Date|string} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

/**
 * Generate a random string
 * @param {number} length - Length of string
 * @returns {string} - Random string
 */
function generateRandomString(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = {
  formatDate,
  generateRandomString,
};
```

---

## Adding Tests

### 1. Create Test File

**File**: `tests/api/examples.test.js`

```javascript
const request = require('supertest');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, cleanupTestDatabase } = require('../setup');

// Mock db module
const mockDb = {
  query: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/models/example');

const Example = require('../../src/models/example');

describe('Examples API', () => {
  let db;
  let testUser;
  let apiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    testUser = await createTestUser(db, {
      username: 'testuser',
      email: 'test@example.com',
    });
    apiKey = await createTestApiKey(db, testUser.id, 'Test Key');
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a new example', async () => {
    const exampleData = {
      user_id: testUser.id,
      name: 'Test Example',
      description: 'Test description',
    };

    Example.create = jest.fn().mockResolvedValue({
      id: 1,
      ...exampleData,
    });

    const response = await request(app).post('/api/examples').set('X-API-Key', apiKey.api_key).send({ name: 'Test Example', description: 'Test description' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe('Test Example');
  });

  it('should return 400 when name is missing', async () => {
    const response = await request(app).post('/api/examples').set('X-API-Key', apiKey.api_key).send({ description: 'No name' });

    expect(response.status).toBe(400);
  });
});
```

### 2. Run Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- examples.test.js

# Run with coverage
npm run test:coverage

# Run in watch mode (during development)
npm run test:watch
```

---

## Common Helper Functions

### Sanitization

```javascript
const sanitizer = require('./lib/sanitizer');

// Strip all HTML and decode entities
const cleanText = sanitizer.stripAll(userInput);

// Sanitize version numbers
const version = sanitizer.sanitizeVersion(versionString);

// Check if string is URL
if (sanitizer.isUrl(input)) { ... }
```

### Email HTML Sanitization

```javascript
const { sanitizeEmailHtml } = require('./lib/htmlSanitizer');

// Sanitize user-provided HTML for email templates
const safeHtml = sanitizeEmailHtml(userHtml);
```

### Password Validation

```javascript
const { validatePassword, getPasswordStrength } = require('./lib/passwordValidation');

// Validate password meets requirements
const result = validatePassword(password);
if (!result.isValid) {
  return res.status(400).send(result.errors.join(', '));
}

// Get password strength
const strength = getPasswordStrength(password);
// Returns: 'weak', 'medium', 'strong'
```

### Version Comparison

```javascript
const versionCompare = require('./lib/versionCompare');

// Compare version strings
if (versionCompare('1.2.3', '1.2.4') < 0) {
  console.log('1.2.3 is older than 1.2.4');
}
```

---

## Environment Variables

Add new environment variables in two places:

### 1. env.sample

```plaintext
# New Feature Configuration
NEW_FEATURE_ENABLED=true
NEW_FEATURE_API_KEY=your-key-here
```

### 2. src/lib/env.js (if special parsing needed)

```javascript
function normalizeEnv() {
  // Add custom parsing logic
  if (process.env.NEW_FEATURE_API_KEY) {
    process.env.NEW_FEATURE_API_KEY = process.env.NEW_FEATURE_API_KEY.trim();
  }
}
```

### 3. Use in Code

```javascript
const isEnabled = process.env.NEW_FEATURE_ENABLED === 'true';
const apiKey = process.env.NEW_FEATURE_API_KEY;
```

---

## Summary

When adding features:

1. **Model** - Database operations
2. **Route** - API endpoints with Swagger docs
3. **Middleware** - Reusable request processing
4. **Tests** - Automated testing
5. **Migration** - Schema changes
6. **Documentation** - Update relevant docs

Always follow existing patterns for consistency.
