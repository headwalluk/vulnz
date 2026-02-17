/**
 * Ecosystems API Tests
 *
 * Tests for GET /api/ecosystems endpoint
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
const ecosystemsRoutes = require('../../src/routes/ecosystems');

describe('Ecosystems API', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create ecosystems table (not included in base schema)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ecosystems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed active ecosystems
    await db.run(`INSERT INTO ecosystems (slug, name, description, active) VALUES ('wordpress', 'WordPress', 'WordPress plugins and themes', 1)`);
    await db.run(`INSERT INTO ecosystems (slug, name, description, active) VALUES ('npm', 'npm', 'Node.js npm packages', 1)`);
    // Seed an inactive ecosystem to verify it is excluded
    await db.run(`INSERT INTO ecosystems (slug, name, description, active) VALUES ('inactive-eco', 'Inactive', 'An inactive ecosystem', 0)`);

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
    app.use('/api/ecosystems', ecosystemsRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('GET /api/ecosystems', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app).get('/api/ecosystems');
      expect(response.status).toBe(401);
    });

    it('should return 200 with a valid API key', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
    });

    it('should return an array', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return only active ecosystems', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      // Two active ecosystems were seeded (wordpress + npm); inactive-eco must not appear
      expect(response.body.length).toBe(2);
    });

    it('should include the wordpress and npm ecosystems', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      const slugs = response.body.map((eco) => eco.slug);
      expect(slugs).toContain('wordpress');
      expect(slugs).toContain('npm');
    });

    it('should not include the inactive ecosystem', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      const slugs = response.body.map((eco) => eco.slug);
      expect(slugs).not.toContain('inactive-eco');
    });

    it('should return ecosystems with the correct shape', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      for (const eco of response.body) {
        expect(eco).toHaveProperty('id');
        expect(eco).toHaveProperty('slug');
        expect(eco).toHaveProperty('name');
        expect(eco).toHaveProperty('active');
        expect(typeof eco.id).toBe('number');
        expect(typeof eco.slug).toBe('string');
        expect(typeof eco.name).toBe('string');
        expect(typeof eco.active).toBe('boolean');
      }
    });

    it('should return active field as boolean true for all returned ecosystems', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      for (const eco of response.body) {
        expect(eco.active).toBe(true);
      }
    });

    it('should return integer ids (not strings)', async () => {
      const response = await request(app).get('/api/ecosystems').set('X-API-Key', adminApiKey);
      expect(response.status).toBe(200);
      for (const eco of response.body) {
        expect(Number.isInteger(eco.id)).toBe(true);
      }
    });
  });
});
