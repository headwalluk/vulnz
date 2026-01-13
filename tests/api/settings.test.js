/**
 * Settings API Tests
 *
 * Tests for /api/settings endpoints including authentication and authorization
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, cleanupTestDatabase } = require('../setup');

// We'll mock the db module dynamically
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Import routes and middleware after mocking
const settingsRoutes = require('../../src/routes/settings');
const { apiOrSessionAuth } = require('../../src/middleware/auth');

describe('Settings API', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;
  let regularUser;
  let regularApiKey;

  beforeAll(async () => {
    // Set environment variable for tests
    process.env.LIST_PAGE_SIZE = '10';

    // Create test database
    db = await createTestDatabase();

    // Update mock to use our test database
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create test users with production schema
    adminUser = await createTestUser(db, {
      username: 'admin@example.com',
      role: 'administrator',
    });
    adminApiKey = await createTestApiKey(db, adminUser.id, 'Admin Test Key');

    regularUser = await createTestUser(db, {
      username: 'user@example.com',
      role: 'user',
    });
    regularApiKey = await createTestApiKey(db, regularUser.id, 'User Test Key');

    // Use the real Passport configuration from production
    require('../../src/config/passport');

    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Setup session middleware
    app.use(
      session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false },
      })
    );

    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());

    // Mock database connection for routes
    app.use((req, res, next) => {
      req.db = db;
      next();
    });

    // Add auth middleware
    app.use(apiOrSessionAuth);

    // Mount settings routes
    app.use('/api/settings', settingsRoutes);

    // Error handler
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message });
    });
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('GET /api/settings', () => {
    test('should allow authenticated admin to list all settings', async () => {
      const response = await request(app).get('/api/settings').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body).toHaveProperty('settings');
      expect(Array.isArray(response.body.settings)).toBe(true);
      expect(response.body.settings.length).toBeGreaterThan(0);
    });

    test('should allow authenticated regular user to list all settings', async () => {
      const response = await request(app).get('/api/settings').set('X-API-Key', regularApiKey).expect(200);

      expect(response.body).toHaveProperty('settings');
      expect(Array.isArray(response.body.settings)).toBe(true);
    });

    test('should reject unauthenticated requests', async () => {
      await request(app).get('/api/settings').expect(401);
    });

    test('should filter by category when provided', async () => {
      const response = await request(app).get('/api/settings?category=wordpress').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body).toHaveProperty('settings');
      response.body.settings.forEach((setting) => {
        expect(setting.category).toBe('wordpress');
      });
    });

    test('should return grouped settings when requested', async () => {
      const response = await request(app).get('/api/settings?grouped=true').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body).toHaveProperty('settings');
      expect(typeof response.body.settings).toBe('object');
      expect(response.body.settings).toHaveProperty('wordpress');
    });
  });

  describe('GET /api/settings/:key', () => {
    test('should allow authenticated user to get a single setting', async () => {
      const response = await request(app).get('/api/settings/wordpress.current_version').set('X-API-Key', regularApiKey).expect(200);

      expect(response.body).toHaveProperty('key');
      expect(response.body).toHaveProperty('value');
      expect(response.body.key).toBe('wordpress.current_version');
    });

    test('should reject unauthenticated requests', async () => {
      await request(app).get('/api/settings/wordpress.current_version').expect(401);
    });

    test('should return 404 for non-existent setting', async () => {
      await request(app).get('/api/settings/nonexistent.setting').set('X-API-Key', regularApiKey).expect(404);
    });
  });

  describe('PUT /api/settings/:key', () => {
    test('should allow admin to create a new setting', async () => {
      const response = await request(app)
        .put('/api/settings/test.new_setting')
        .set('X-API-Key', adminApiKey)
        .send({
          value: 'test_value',
          type: 'string',
          description: 'Test setting',
          category: 'test',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('key', 'test.new_setting');
      expect(response.body).toHaveProperty('value', 'test_value');
    });

    test('should allow admin to update an existing setting', async () => {
      const response = await request(app)
        .put('/api/settings/test.new_setting')
        .set('X-API-Key', adminApiKey)
        .send({
          value: 'updated_value',
          type: 'string',
        })
        .expect(200);

      expect(response.body.value).toBe('updated_value');
    });

    test('should reject non-admin users', async () => {
      await request(app)
        .put('/api/settings/test.user_setting')
        .set('X-API-Key', regularApiKey)
        .send({
          value: 'test',
          type: 'string',
        })
        .expect(403);
    });

    test('should reject unauthenticated requests', async () => {
      await request(app)
        .put('/api/settings/test.setting')
        .send({
          value: 'test',
          type: 'string',
        })
        .expect(401);
    });

    test('should reject invalid type parameter', async () => {
      await request(app)
        .put('/api/settings/test.invalid_type')
        .set('X-API-Key', adminApiKey)
        .send({
          value: '42',
          type: 'invalid_type',
        })
        .expect(400);
    });
  });

  describe('DELETE /api/settings/:key', () => {
    beforeEach(async () => {
      // Create a test setting to delete
      await db.query(
        `INSERT OR IGNORE INTO app_settings (setting_key, setting_value, value_type, category, is_system) 
         VALUES (?, ?, ?, ?, ?)`,
        ['test.deletable', 'test', 'string', 'test', 0]
      );
    });

    test('should allow admin to delete non-system settings', async () => {
      await request(app).delete('/api/settings/test.deletable').set('X-API-Key', adminApiKey).expect(200);
    });

    test('should prevent deletion of system settings', async () => {
      await request(app).delete('/api/settings/wordpress.current_version').set('X-API-Key', adminApiKey).expect(403);
    });

    test('should reject non-admin users', async () => {
      await request(app).delete('/api/settings/test.deletable').set('X-API-Key', regularApiKey).expect(403);
    });

    test('should reject unauthenticated requests', async () => {
      await request(app).delete('/api/settings/test.deletable').expect(401);
    });

    test('should return 404 for non-existent setting', async () => {
      await request(app).delete('/api/settings/nonexistent.setting').set('X-API-Key', adminApiKey).expect(404);
    });
  });

  describe('Type Casting', () => {
    test('should cast integer values correctly', async () => {
      await request(app)
        .put('/api/settings/test.integer_value')
        .set('X-API-Key', adminApiKey)
        .send({
          value: '42',
          type: 'integer',
        })
        .expect(200);

      const response = await request(app).get('/api/settings/test.integer_value').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body.value).toBe(42);
      expect(typeof response.body.value).toBe('number');
    });

    test('should cast boolean values correctly', async () => {
      await request(app)
        .put('/api/settings/test.boolean_value')
        .set('X-API-Key', adminApiKey)
        .send({
          value: 'true',
          type: 'boolean',
        })
        .expect(200);

      const response = await request(app).get('/api/settings/test.boolean_value').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body.value).toBe(true);
      expect(typeof response.body.value).toBe('boolean');
    });

    test('should cast float values correctly', async () => {
      await request(app)
        .put('/api/settings/test.float_value')
        .set('X-API-Key', adminApiKey)
        .send({
          value: '3.14',
          type: 'float',
        })
        .expect(200);

      const response = await request(app).get('/api/settings/test.float_value').set('X-API-Key', adminApiKey).expect(200);

      expect(response.body.value).toBe(3.14);
      expect(typeof response.body.value).toBe('number');
    });
  });
});
