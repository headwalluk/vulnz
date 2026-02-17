/**
 * Websites API — npm-package Component Tests
 *
 * Tests for PUT /api/websites/:domain component handling:
 *   - Generic `components` array with npm-package type
 *   - Backward-compatibility with legacy `wordpress-plugins` and `wordpress-themes` keys
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, createTestWebsite, cleanupTestDatabase } = require('../setup');

// ── Mock the db module ──────────────────────────────────────────────────────
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// ── Mock all model dependencies used by the websites route ──────────────────
jest.mock('../../src/models/website');
jest.mock('../../src/models/user');
jest.mock('../../src/models/component');
jest.mock('../../src/models/release');
jest.mock('../../src/models/websiteComponent');
jest.mock('../../src/models/securityEvent');
jest.mock('../../src/models/securityEventType');
jest.mock('../../src/models/fileSecurityIssue');
jest.mock('../../src/models/componentChange');
jest.mock('../../src/models/ecosystem');
jest.mock('../../src/lib/geoip');

// Import after mocking
const websitesRoutes = require('../../src/routes/websites');
const Website = require('../../src/models/website');
const User = require('../../src/models/user');
const Component = require('../../src/models/component');
const Release = require('../../src/models/release');
const WebsiteComponent = require('../../src/models/websiteComponent');
const ComponentChange = require('../../src/models/componentChange');

// ── Helpers ─────────────────────────────────────────────────────────────────

let releaseCounter = 100;

/** Returns a predictable mock release record */
function makeRelease(componentId, version) {
  return { id: ++releaseCounter, component_id: componentId, version };
}

describe('Websites API — npm-package Component Tests', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;
  let testWebsite;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create admin user
    adminUser = await createTestUser(db, {
      username: 'admin@example.com',
      role: 'administrator',
    });
    adminApiKey = await createTestApiKey(db, adminUser.id);

    // Create a test website
    testWebsite = await createTestWebsite(db, {
      domain: 'npm-test.example.com',
      user_id: adminUser.id,
      title: 'NPM Test Website',
    });

    // ── Website model mocks ────────────────────────────────────────────────
    Website.findByDomain = jest.fn().mockImplementation(async (domain) => {
      const rows = await db.query('SELECT * FROM websites WHERE domain = ?', [domain]);
      return rows[0] || null;
    });

    Website.update = jest.fn().mockResolvedValue(true);
    Website.touch = jest.fn().mockResolvedValue(true);

    Website.updateVersions = jest.fn().mockResolvedValue(true);

    // ── User model mocks ───────────────────────────────────────────────────
    User.getRoles = jest.fn().mockImplementation(async (userId) => {
      const rows = await db.query('SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?', [userId]);
      return rows.map((row) => row.name);
    });

    User.findUserById = jest.fn().mockImplementation(async (userId) => {
      const rows = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
      return rows[0] || null;
    });

    // ── Component / Release / WebsiteComponent mocks ───────────────────────
    let componentCounter = 1;

    Component.findOrCreate = jest.fn().mockImplementation(async (slug, type) => {
      return { id: componentCounter++, slug, component_type_slug: type };
    });

    Component.invalidateWpOrgSyncStatus = jest.fn().mockResolvedValue(undefined);

    Release.findOrCreate = jest.fn().mockImplementation(async (componentId, version) => {
      return makeRelease(componentId, version);
    });

    Release.findById = jest.fn().mockImplementation(async (releaseId) => {
      return { id: releaseId, component_id: 1, version: '1.0.0' };
    });

    WebsiteComponent.getComponentsForChangeTracking = jest.fn().mockResolvedValue([]);
    WebsiteComponent.deleteByType = jest.fn().mockResolvedValue(undefined);
    WebsiteComponent.create = jest.fn().mockResolvedValue(undefined);
    WebsiteComponent.getPlugins = jest.fn().mockResolvedValue([]);
    WebsiteComponent.getThemes = jest.fn().mockResolvedValue([]);

    ComponentChange.recordChanges = jest.fn().mockResolvedValue({ added: [], removed: [], updated: [] });

    // ── Passport ───────────────────────────────────────────────────────────
    require('../../src/config/passport');

    // ── Express app ────────────────────────────────────────────────────────
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
    app.use('/api/websites', websitesRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  // ── reset per-test mock state ──────────────────────────────────────────────
  beforeEach(() => {
    Component.findOrCreate.mockClear();
    Release.findOrCreate.mockClear();
    WebsiteComponent.deleteByType.mockClear();
    WebsiteComponent.create.mockClear();
    ComponentChange.recordChanges.mockClear();
    Website.touch.mockClear();
  });

  // ============================================================
  // Generic `components` array — npm-package type
  // ============================================================

  describe('PUT /api/websites/:domain with components array (npm-package)', () => {
    it('should accept a valid npm-package components array and return 200', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [
            { slug: 'express', version: '4.18.2', type: 'npm-package' },
            { slug: 'lodash', version: '4.17.21', type: 'npm-package' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Website updated');
    });

    it('should call WebsiteComponent.deleteByType with npm-package before inserting', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [{ slug: 'express', version: '4.18.2', type: 'npm-package' }],
        });

      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'npm-package');
    });

    it('should call Component.findOrCreate for each npm-package component', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [
            { slug: 'express', version: '4.18.2', type: 'npm-package' },
            { slug: 'lodash', version: '4.17.21', type: 'npm-package' },
          ],
        });

      expect(Component.findOrCreate).toHaveBeenCalledWith('express', 'npm-package', 'express');
      expect(Component.findOrCreate).toHaveBeenCalledWith('lodash', 'npm-package', 'lodash');
    });

    it('should call Website.touch after processing components', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [{ slug: 'express', version: '4.18.2', type: 'npm-package' }],
        });

      expect(Website.touch).toHaveBeenCalledWith(testWebsite.id);
    });

    it('should return 400 when components is not an array', async () => {
      const response = await request(app).put(`/api/websites/${testWebsite.domain}`).set('X-API-Key', adminApiKey).send({ components: 'not-an-array' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/must be an array/i);
    });

    it('should return 400 when a component entry is missing slug', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [{ version: '1.0.0', type: 'npm-package' }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/slug.*version.*type/i);
    });

    it('should return 400 when a component entry is missing version', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [{ slug: 'express', type: 'npm-package' }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/slug.*version.*type/i);
    });

    it('should return 400 when a component entry is missing type', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [{ slug: 'express', version: '4.18.2' }],
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/slug.*version.*type/i);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .send({ components: [{ slug: 'express', version: '4.18.2', type: 'npm-package' }] });

      expect(response.status).toBe(401);
    });

    it('should group components by type and delete each type atomically', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          components: [
            { slug: 'express', version: '4.18.2', type: 'npm-package' },
            { slug: 'woocommerce', version: '8.0.0', type: 'wordpress-plugin' },
          ],
        });

      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'npm-package');
      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'wordpress-plugin');
    });
  });

  // ============================================================
  // Backward-compatibility — legacy wordpress-plugins key
  // ============================================================

  describe('PUT /api/websites/:domain with wordpress-plugins (legacy format)', () => {
    it('should accept wordpress-plugins array and return 200', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-plugins': [
            { slug: 'woocommerce', version: '8.0.0' },
            { slug: 'jetpack', version: '12.1' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Website updated');
    });

    it('should call WebsiteComponent.deleteByType with wordpress-plugin', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-plugins': [{ slug: 'woocommerce', version: '8.0.0' }],
        });

      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'wordpress-plugin');
    });

    it('should call Component.findOrCreate for each plugin with wordpress-plugin type', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-plugins': [{ slug: 'woocommerce', version: '8.0.0' }],
        });

      expect(Component.findOrCreate).toHaveBeenCalledWith('woocommerce', 'wordpress-plugin', 'woocommerce');
    });
  });

  // ============================================================
  // Backward-compatibility — legacy wordpress-themes key
  // ============================================================

  describe('PUT /api/websites/:domain with wordpress-themes (legacy format)', () => {
    it('should accept wordpress-themes array and return 200', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-themes': [{ slug: 'twentytwentythree', version: '1.2' }],
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Website updated');
    });

    it('should call WebsiteComponent.deleteByType with wordpress-theme', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-themes': [{ slug: 'twentytwentythree', version: '1.2' }],
        });

      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'wordpress-theme');
    });

    it('should call Component.findOrCreate with wordpress-theme type', async () => {
      await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-themes': [{ slug: 'twentytwentythree', version: '1.2' }],
        });

      expect(Component.findOrCreate).toHaveBeenCalledWith('twentytwentythree', 'wordpress-theme', 'twentytwentythree');
    });
  });

  // ============================================================
  // Legacy and new formats can coexist in the same request
  // ============================================================

  describe('PUT /api/websites/:domain — mixing legacy keys and components array', () => {
    it('should process both wordpress-plugins and components array in a single request', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-plugins': [{ slug: 'woocommerce', version: '8.0.0' }],
          components: [{ slug: 'express', version: '4.18.2', type: 'npm-package' }],
        });

      expect(response.status).toBe(200);

      // Both types should have been deleted and re-created
      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'wordpress-plugin');
      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'npm-package');
      expect(Component.findOrCreate).toHaveBeenCalledWith('woocommerce', 'wordpress-plugin', 'woocommerce');
      expect(Component.findOrCreate).toHaveBeenCalledWith('express', 'npm-package', 'express');
    });

    it('should process wordpress-themes and npm components together', async () => {
      const response = await request(app)
        .put(`/api/websites/${testWebsite.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({
          'wordpress-themes': [{ slug: 'twentytwentythree', version: '1.2' }],
          components: [{ slug: 'lodash', version: '4.17.21', type: 'npm-package' }],
        });

      expect(response.status).toBe(200);

      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'wordpress-theme');
      expect(WebsiteComponent.deleteByType).toHaveBeenCalledWith(testWebsite.id, 'npm-package');
    });
  });
});
