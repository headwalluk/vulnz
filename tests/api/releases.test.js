/**
 * Releases API Tests
 *
 * Tests for POST /api/releases/bulk endpoint
 */

const request = require('supertest');
const express = require('express');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

describe('Releases API', () => {
  let app;
  let db;
  let regularUser;
  let regularApiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    regularUser = await createTestUser(db, {
      username: 'release-user@example.com',
      role: 'user',
    });
    regularApiKey = await createTestApiKey(db, regularUser.id);

    require('../../src/config/passport');

    app = express();
    app.use(express.json());
    app.use(passport.initialize());

    delete require.cache[require.resolve('../../src/routes/releases')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    const releaseRoutes = require('../../src/routes/releases');
    app.use('/api/releases', releaseRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('POST /api/releases/bulk', () => {
    test('should require authentication', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .send({ items: [] });

      expect(response.status).toBe(401);
    });

    test('should reject empty body', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/items/);
    });

    test('should reject non-array items', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items: 'not-an-array' });

      expect(response.status).toBe(400);
    });

    test('should reject empty items array', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items: [] });

      expect(response.status).toBe(400);
    });

    test('should reject more than 500 items', async () => {
      const items = Array.from({ length: 501 }, (_, i) => ({
        componentTypeSlug: 'wordpress-plugin',
        componentSlug: `plugin-${i}`,
        version: '1.0.0',
      }));

      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/500/);
    });

    test('should validate required fields on each item', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            { componentSlug: 'test', version: '1.0' },
            { componentTypeSlug: 'wordpress-plugin', version: '1.0' },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'test' },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toHaveLength(3);
      expect(response.body.errors[0].index).toBe(0);
      expect(response.body.errors[0].message).toMatch(/componentTypeSlug/);
      expect(response.body.errors[1].index).toBe(1);
      expect(response.body.errors[1].message).toMatch(/componentSlug/);
      expect(response.body.errors[2].index).toBe(2);
      expect(response.body.errors[2].message).toMatch(/version/);
    });

    test('should bulk-create releases for a single item', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'release-test-plugin',
              version: '1.0.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.duplicates).toBe(0);

      // Verify component was created
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'release-test-plugin',
        'wordpress-plugin',
      ]);
      expect(comp.length).toBe(1);

      // Verify release was created
      const release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp[0].id, '1.0.0']);
      expect(release.length).toBe(1);

      // Verify no vulnerabilities were created
      const vulns = await db.query('SELECT * FROM vulnerabilities WHERE release_id = ?', [release[0].id]);
      expect(vulns.length).toBe(0);
    });

    test('should handle multiple items across different components', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'multi-rel-a',
              version: '2.0.0',
            },
            {
              componentTypeSlug: 'npm-package',
              componentSlug: 'multi-rel-b',
              version: '3.0.0',
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'multi-rel-a',
              version: '2.1.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(3);
      expect(response.body.duplicates).toBe(0);
    });

    test('should skip duplicate releases', async () => {
      // First request creates the release
      await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'dup-rel-plugin',
              version: '1.0.0',
            },
          ],
        });

      // Second request should report duplicate
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'dup-rel-plugin',
              version: '1.0.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(0);
      expect(response.body.duplicates).toBe(1);
    });

    test('should skip duplicate versions within the same batch', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'intra-dup-plugin',
              version: '4.0.0',
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'intra-dup-plugin',
              version: '4.0.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.duplicates).toBe(1);

      // Only one release record in database
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'intra-dup-plugin',
        'wordpress-plugin',
      ]);
      const releases = await db.query('SELECT * FROM releases WHERE component_id = ?', [comp[0].id]);
      expect(releases.length).toBe(1);
    });

    test('should reuse existing components and releases', async () => {
      // Pre-create a component and release
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [
        'pre-existing-rel',
        'wordpress-plugin',
        'Pre-existing Plugin',
        'Already exists',
      ]);

      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'pre-existing-rel',
        'wordpress-plugin',
      ]);
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [comp[0].id, '5.0.0']);

      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'pre-existing-rel',
              version: '5.0.0',
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'pre-existing-rel',
              version: '5.1.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.duplicates).toBe(1);

      // Should not have created a duplicate component
      const comps = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'pre-existing-rel',
        'wordpress-plugin',
      ]);
      expect(comps.length).toBe(1);
    });

    test('should report errors for invalid component types without failing entire batch', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'partial-rel-ok',
              version: '1.0.0',
            },
            {
              componentTypeSlug: 'nonexistent-type',
              componentSlug: 'partial-rel-fail',
              version: '1.0.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.errors).toHaveLength(1);
      expect(response.body.errors[0].index).toBe(1);
      expect(response.body.errors[0].message).toMatch(/Component type not found/);
    });

    test('should cache component type lookups within a batch', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'cache-rel-a',
              version: '1.0.0',
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'cache-rel-b',
              version: '1.0.0',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
    });

    test('should sanitize component slugs and versions', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'Sanitize-Rel.zip',
              version: '1.0.0abc',
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);

      // Slug should be lowercased with extension stripped
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'sanitize-rel',
        'wordpress-plugin',
      ]);
      expect(comp.length).toBe(1);

      // Version should have non-numeric/dot chars stripped
      const release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp[0].id, '1.0.0']);
      expect(release.length).toBe(1);
    });

    test('should handle multiple versions of the same component', async () => {
      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'multi-ver', version: '1.0' },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'multi-ver', version: '1.1' },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'multi-ver', version: '1.2' },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'multi-ver', version: '2.0' },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(4);
      expect(response.body.duplicates).toBe(0);

      // One component, four releases
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', [
        'multi-ver',
        'wordpress-plugin',
      ]);
      expect(comp.length).toBe(1);

      const releases = await db.query('SELECT * FROM releases WHERE component_id = ?', [comp[0].id]);
      expect(releases.length).toBe(4);
    });

    test('should accept exactly 500 items', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({
        componentTypeSlug: 'wordpress-plugin',
        componentSlug: `limit-test-${i}`,
        version: '1.0.0',
      }));

      const response = await request(app)
        .post('/api/releases/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(500);
    });
  });
});
