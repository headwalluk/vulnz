/**
 * Component Types API Tests
 *
 * Tests for GET /api/component-types endpoint
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, cleanupTestDatabase } = require('../setup');

// Mock the db module
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Import routes after mocking
const componentTypesRoutes = require('../../src/routes/componentTypes');

describe('Component Types API', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create a test user
    adminUser = await createTestUser(db, {
      username: 'admin@example.com',
      role: 'administrator',
    });
    adminApiKey = await createTestApiKey(db, adminUser.id);

    // Configure passport (uses mocked db)
    require('../../src/config/passport');

    // Build the Express test app
    app = express();
    app.use(express.json());
    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
      })
    );
    app.use(passport.initialize());
    app.use(passport.session());
    app.use('/api/component-types', componentTypesRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('GET /api/component-types', () => {
    it('should return 200 without authentication (public endpoint)', async () => {
      const response = await request(app).get('/api/component-types');
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return 200 with a valid API key', async () => {
      const response = await request(app).get('/api/component-types').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
    });

    it('should return an array of component types', async () => {
      const response = await request(app).get('/api/component-types');
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(3);
    });

    it('should include wordpress-plugin, wordpress-theme, and npm-package', async () => {
      const response = await request(app).get('/api/component-types');
      const slugs = response.body.map((ct) => ct.slug);
      expect(slugs).toContain('wordpress-plugin');
      expect(slugs).toContain('wordpress-theme');
      expect(slugs).toContain('npm-package');
    });

    it('should return component types with the correct shape', async () => {
      const response = await request(app).get('/api/component-types');
      for (const ct of response.body) {
        expect(ct).toHaveProperty('slug');
        expect(ct).toHaveProperty('ecosystem');
        expect(ct).toHaveProperty('title');
        expect(typeof ct.slug).toBe('string');
        expect(typeof ct.title).toBe('string');
      }
    });

    it('should associate component types with the correct ecosystem', async () => {
      const response = await request(app).get('/api/component-types');
      const bySlug = Object.fromEntries(response.body.map((ct) => [ct.slug, ct]));
      expect(bySlug['wordpress-plugin'].ecosystem).toBe('wordpress');
      expect(bySlug['wordpress-theme'].ecosystem).toBe('wordpress');
      expect(bySlug['npm-package'].ecosystem).toBe('npm');
    });

    it('should return results sorted by slug', async () => {
      const response = await request(app).get('/api/component-types');
      const slugs = response.body.map((ct) => ct.slug);
      const sorted = [...slugs].sort();
      expect(slugs).toEqual(sorted);
    });
  });
});
