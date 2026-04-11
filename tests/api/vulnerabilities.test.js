/**
 * Vulnerabilities API Tests
 *
 * Tests for POST /api/vulnerabilities/bulk endpoint
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

describe('Vulnerabilities API', () => {
  let app;
  let db;
  let regularUser;
  let regularApiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    regularUser = await createTestUser(db, {
      username: 'vuln-user@example.com',
      role: 'user',
    });
    regularApiKey = await createTestApiKey(db, regularUser.id, 'Vuln User Key');

    require('../../src/config/passport');

    app = express();
    app.use(express.json());
    app.use(passport.initialize());

    delete require.cache[require.resolve('../../src/routes/vulnerabilities')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    const vulnerabilityRoutes = require('../../src/routes/vulnerabilities');
    app.use('/api/vulnerabilities', vulnerabilityRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('POST /api/vulnerabilities/bulk', () => {
    test('should require authentication', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .send({ items: [] });

      expect(response.status).toBe(401);
    });

    test('should reject empty body', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/items/);
    });

    test('should reject non-array items', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items: 'not-an-array' });

      expect(response.status).toBe(400);
    });

    test('should reject empty items array', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items: [] });

      expect(response.status).toBe(400);
    });

    test('should validate required fields on each item', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            { componentSlug: 'test', version: '1.0', urls: ['https://example.com'] },
            { componentTypeSlug: 'wordpress-plugin', version: '1.0', urls: ['https://example.com'] },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'test', urls: ['https://example.com'] },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'test', version: '1.0', urls: [] },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toHaveLength(4);
      expect(response.body.errors[0].index).toBe(0);
      expect(response.body.errors[1].index).toBe(1);
      expect(response.body.errors[2].index).toBe(2);
      expect(response.body.errors[3].index).toBe(3);
    });

    test('should reject invalid URL formats', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'test-plugin',
              version: '1.0.0',
              urls: ['not-a-url'],
            },
          ],
        });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toMatch(/Invalid URL/);
    });

    test('should bulk-create vulnerabilities for a single item', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'bulk-test-plugin',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-0001', 'https://cve.example.com/CVE-2026-0002'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
      expect(response.body.duplicates).toBe(0);

      // Verify in database
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', ['bulk-test-plugin', 'wordpress-plugin']);
      expect(comp.length).toBe(1);

      const release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp[0].id, '1.0.0']);
      expect(release.length).toBe(1);

      const vulns = await db.query('SELECT * FROM vulnerabilities WHERE release_id = ?', [release[0].id]);
      expect(vulns.length).toBe(2);
    });

    test('should handle multiple items across different components', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'multi-test-a',
              version: '2.0.0',
              urls: ['https://cve.example.com/CVE-2026-1001'],
            },
            {
              componentTypeSlug: 'npm-package',
              componentSlug: 'multi-test-b',
              version: '3.0.0',
              urls: ['https://cve.example.com/CVE-2026-2001', 'https://cve.example.com/CVE-2026-2002'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(3);
      expect(response.body.duplicates).toBe(0);
    });

    test('should skip duplicate vulnerabilities', async () => {
      // First request creates them
      await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'dup-test-plugin',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-DUP1'],
            },
          ],
        });

      // Second request should report duplicate
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'dup-test-plugin',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-DUP1'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(0);
      expect(response.body.duplicates).toBe(1);
    });

    test('should reuse existing components and releases', async () => {
      // Create component and release first
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [
        'existing-plugin',
        'wordpress-plugin',
        'Existing Plugin',
        'Already exists',
      ]);

      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', ['existing-plugin', 'wordpress-plugin']);
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [comp[0].id, '5.0.0']);

      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'existing-plugin',
              version: '5.0.0',
              urls: ['https://cve.example.com/CVE-2026-EXIST'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);

      // Should not have created a duplicate component
      const comps = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', ['existing-plugin', 'wordpress-plugin']);
      expect(comps.length).toBe(1);
    });

    test('should report errors for invalid component types without failing entire batch', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'partial-ok',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-OK1'],
            },
            {
              componentTypeSlug: 'nonexistent-type',
              componentSlug: 'partial-fail',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-FAIL1'],
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
      // Send multiple items with the same component type
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'cache-test-a',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-CA1'],
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'cache-test-b',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-CB1'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
    });

    test('should handle items sharing the same component and version', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'shared-comp',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-S1'],
            },
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'shared-comp',
              version: '1.0.0',
              urls: ['https://cve.example.com/CVE-2026-S2'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
      expect(response.body.duplicates).toBe(0);
    });

    test('should sanitize component slugs and versions', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'Sanitize-Me.zip',
              version: '1.0.0abc',
              urls: ['https://cve.example.com/CVE-2026-SAN1'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);

      // Slug should be lowercased with extension stripped
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', ['sanitize-me', 'wordpress-plugin']);
      expect(comp.length).toBe(1);

      // Version should have non-numeric/dot chars stripped
      const release = await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [comp[0].id, '1.0.0']);
      expect(release.length).toBe(1);
    });
  });
});
