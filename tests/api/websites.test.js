/**
 * Websites API Tests
 *
 * Tests for /api/websites endpoints, focusing on version updates
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, createTestWebsite, cleanupTestDatabase } = require('../setup');

// Mock the db module
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Mock all the model dependencies
jest.mock('../../src/models/website');
jest.mock('../../src/models/user');
jest.mock('../../src/models/component');
jest.mock('../../src/models/release');
jest.mock('../../src/models/websiteComponent');
jest.mock('../../src/models/securityEvent');
jest.mock('../../src/models/securityEventType');
jest.mock('../../src/models/fileSecurityIssue');
jest.mock('../../src/models/componentChange');
jest.mock('../../src/lib/geoip');

// Import routes and middleware after mocking
const websitesRoutes = require('../../src/routes/websites');
const Website = require('../../src/models/website');
const User = require('../../src/models/user');

describe('Websites API - Version Updates', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;
  let testWebsite;

  beforeAll(async () => {
    // Create test database
    db = await createTestDatabase();

    // Update mock to use our test database
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create admin user
    adminUser = await createTestUser(db, {
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
    });
    adminApiKey = await createTestApiKey(db, adminUser.id, 'Admin Test Key');

    // Create test website
    testWebsite = await createTestWebsite(db, {
      domain: 'test.example.com',
      user_id: adminUser.id,
      title: 'Test Website',
    });

    // Setup mocks for Website and User models
    Website.findByDomain = jest.fn().mockImplementation(async (domain) => {
      const websites = await db.query('SELECT * FROM websites WHERE domain = ?', [domain]);
      return websites[0] || null;
    });

    Website.update = jest.fn().mockImplementation(async (domain, data) => {
      const fields = Object.keys(data);
      const values = Object.values(data);

      if (data.meta && typeof data.meta === 'object') {
        data.meta = JSON.stringify(data.meta);
      }

      const setClause = fields.map((field) => `${field} = ?`).join(', ');

      if (fields.length === 0) {
        return false;
      }

      const query = `UPDATE websites SET ${setClause} WHERE domain = ?`;
      const params = [...values, domain];
      await db.query(query, params);
      return true;
    });

    Website.updateVersions = jest.fn().mockImplementation(async (websiteId, versions) => {
      const fields = [];
      const values = [];

      if (versions.wordpress_version !== undefined) {
        fields.push('wordpress_version = ?');
        values.push(versions.wordpress_version);
      }
      if (versions.php_version !== undefined) {
        fields.push('php_version = ?');
        values.push(versions.php_version);
      }
      if (versions.db_server_type !== undefined) {
        fields.push('db_server_type = ?');
        values.push(versions.db_server_type);
      }
      if (versions.db_server_version !== undefined) {
        fields.push('db_server_version = ?');
        values.push(versions.db_server_version);
      }

      if (fields.length === 0) {
        return false;
      }

      fields.push('versions_last_checked_at = CURRENT_TIMESTAMP');
      values.push(websiteId);
      const query = `UPDATE websites SET ${fields.join(', ')} WHERE id = ?`;
      const result = await db.query(query, values);
      return result.affectedRows > 0;
    });

    Website.touch = jest.fn().mockResolvedValue(true);

    User.getRoles = jest.fn().mockImplementation(async (userId) => {
      const userRoles = await db.query('SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?', [userId]);
      return userRoles.map((row) => row.name);
    });

    // Configure Passport strategies for testing
    const HeaderAPIKeyStrategy = require('passport-headerapikey').HeaderAPIKeyStrategy;
    const crypto = require('crypto');

    passport.use(
      new HeaderAPIKeyStrategy({ header: 'X-API-Key', prefix: '' }, false, async (apiKey, done) => {
        try {
          const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
          const keys = await db.query('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1', [hashedKey]);

          if (!keys || keys.length === 0) {
            return done(null, false);
          }

          const key = keys[0];
          const users = await db.query('SELECT * FROM users WHERE id = ? AND is_active = 1', [key.user_id]);

          if (!users || users.length === 0) {
            return done(null, false);
          }

          return done(null, users[0]);
        } catch (err) {
          return done(err);
        }
      })
    );

    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Setup session middleware
    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
      })
    );

    app.use(passport.initialize());
    app.use(passport.session());

    // Mount routes
    app.use('/api/websites', websitesRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('PUT /api/websites/:domain with versions', () => {
    it('should update versions when provided in request body', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey.token)
        .send({
          versions: {
            wordpress_version: '6.4.2',
            php_version: '8.2.14',
            db_server_type: 'mariadb',
            db_server_version: '10.11.6',
          },
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Website updated');

      // Verify versions were updated in database
      const websites = await db.query('SELECT * FROM websites WHERE id = ?', [testWebsite.id]);
      expect(websites[0].wordpress_version).toBe('6.4.2');
      expect(websites[0].php_version).toBe('8.2.14');
      expect(websites[0].db_server_type).toBe('mariadb');
      expect(websites[0].db_server_version).toBe('10.11.6');
      expect(websites[0].versions_last_checked_at).not.toBeNull();
    });

    it('should reject invalid db_server_type', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey.token)
        .send({
          versions: {
            db_server_type: 'postgresql',
          },
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid db_server_type');
    });

    it('should update only provided version fields', async () => {
      // First set some initial versions
      await db.query('UPDATE websites SET wordpress_version = ?, php_version = ? WHERE id = ?', ['6.4.0', '8.1.0', testWebsite.id]);

      // Update only WordPress version
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey.token)
        .send({
          versions: {
            wordpress_version: '6.4.3',
          },
        });

      expect(response.status).toBe(200);

      // Verify only WordPress version changed
      const websites = await db.query('SELECT * FROM websites WHERE id = ?', [testWebsite.id]);
      expect(websites[0].wordpress_version).toBe('6.4.3');
      expect(websites[0].php_version).toBe('8.1.0'); // Should remain unchanged
    });

    it('should work with both versions and other fields', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey.token)
        .send({
          title: 'Updated Test Website',
          is_dev: true,
          versions: {
            wordpress_version: '6.5.0',
            php_version: '8.3.0',
          },
        });

      expect(response.status).toBe(200);

      // Verify all fields were updated
      const websites = await db.query('SELECT * FROM websites WHERE id = ?', [testWebsite.id]);
      expect(websites[0].title).toBe('Updated Test Website');
      expect(websites[0].is_dev).toBe(1);
      expect(websites[0].wordpress_version).toBe('6.5.0');
      expect(websites[0].php_version).toBe('8.3.0');
    });

    it('should work without versions object (backward compatibility)', async () => {
      const response = await request(app).put(`/api/websites/${testWebsite.domain}`).set('X-API-Key', adminApiKey.token).send({
        title: 'Another Update',
      });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Website updated');

      // Verify title was updated
      const websites = await db.query('SELECT * FROM websites WHERE id = ?', [testWebsite.id]);
      expect(websites[0].title).toBe('Another Update');
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .send({
          versions: {
            wordpress_version: '6.4.2',
          },
        });

      expect(response.status).toBe(401);
    });
  });

  describe('PUT /api/websites/:domain/versions (deprecated)', () => {
    it('should still work for backward compatibility', async () => {
      const response = await request(app).put(`/api/websites/${testWebsite.domain}/versions`).set('X-API-Key', adminApiKey.token).send({
        wordpress_version: '6.4.1',
        php_version: '8.2.13',
        db_server_type: 'mysql',
        db_server_version: '8.0.35',
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Versions updated successfully');

      // Verify versions were updated
      const websites = await db.query('SELECT * FROM websites WHERE id = ?', [testWebsite.id]);
      expect(websites[0].wordpress_version).toBe('6.4.1');
      expect(websites[0].php_version).toBe('8.2.13');
      expect(websites[0].db_server_type).toBe('mysql');
      expect(websites[0].db_server_version).toBe('8.0.35');
    });
  });
});
