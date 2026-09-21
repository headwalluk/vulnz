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

    test('should sanitize component slugs and store exact versions as given', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            {
              componentTypeSlug: 'wordpress-plugin',
              componentSlug: 'Sanitize-Me.zip',
              version: '1.0.0-rc.1',
              urls: ['https://cve.example.com/CVE-2026-SAN1'],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);

      // Slug should be lowercased with extension stripped
      const comp = await db.query('SELECT * FROM components WHERE slug = ? AND component_type_slug = ?', ['sanitize-me', 'wordpress-plugin']);
      expect(comp.length).toBe(1);

      // The version is never rewritten (sanitizeVersion() used to store 1.0.0.1)
      const releases = await db.query('SELECT version FROM releases WHERE component_id = ?', [comp[0].id]);
      expect(releases.map((row) => row.version)).toEqual(['1.0.0-rc.1']);
    });

    test('should reject an exact version that is not a recognisable version', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'exact-ok', version: '2.0', urls: ['https://cve.example.com/exact-ok'] },
            { componentTypeSlug: 'wordpress-plugin', componentSlug: 'exact-bad', version: '1.0.0abc x', urls: ['https://cve.example.com/exact-bad'] },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.errors).toEqual([{ index: 1, message: 'version is not a recognisable version: 1.0.0abc x' }]);
    });

    test('should reject unknown component types during validation', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({ items: [{ componentTypeSlug: 'nonexistent-type', componentSlug: 'type-only', version: '1.0.0', urls: ['https://cve.example.com/type-only'] }] });

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toMatch(/Component type not found/);
    });
  });

  describe('POST /api/vulnerabilities/bulk with ranges (M18)', () => {
    const TYPE = 'wordpress-plugin';
    const ADVISORY_URL = 'https://www.wordfence.com/threat-intel/vulnerabilities/id/946ec633';

    /** Create a component with the given releases, returning its id. */
    async function seedComponent(slug, versions) {
      await db.query('INSERT INTO components (slug, component_type_slug, title, description) VALUES (?, ?, ?, ?)', [slug, TYPE, slug, '']);
      const [component] = await db.query('SELECT id FROM components WHERE slug = ? AND component_type_slug = ?', [slug, TYPE]);
      for (const version of versions) {
        await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component.id, version]);
      }
      return component.id;
    }

    /** List the versions of a component flagged under a URL, sorted. */
    async function flaggedVersions(componentId, url) {
      const rows = await db.query('SELECT r.version FROM vulnerabilities v JOIN releases r ON r.id = v.release_id WHERE r.component_id = ? AND v.url = ? ORDER BY r.version', [
        componentId,
        url,
      ]);
      return rows.map((row) => row.version);
    }

    function postItems(items) {
      return request(app).post('/api/vulnerabilities/bulk').set('X-API-Key', regularApiKey).send({ items });
    }

    test('flags every release below an exclusive upper bound, and not the fix release', async () => {
      const componentId = await seedComponent('range-updraft', ['1.23.0', '1.26.6', '1.26.7', '1.27.0']);

      const response = await postItems([
        { componentTypeSlug: TYPE, componentSlug: 'range-updraft', urls: [ADVISORY_URL], ranges: [{ from: null, to: '1.26.7', toInclusive: false }] },
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ created: 2, duplicates: 0, rangesCreated: 1, rangesDuplicates: 0 });
      expect(await flaggedVersions(componentId, ADVISORY_URL)).toEqual(['1.23.0', '1.26.6']);
    });

    test('flags the bound itself for an inclusive upper bound', async () => {
      const componentId = await seedComponent('range-inclusive', ['1.23.0', '1.23.3', '1.23.4']);

      await postItems([{ componentTypeSlug: TYPE, componentSlug: 'range-inclusive', urls: [ADVISORY_URL], ranges: [{ from: null, to: '1.23.3', toInclusive: true }] }]);

      expect(await flaggedVersions(componentId, ADVISORY_URL)).toEqual(['1.23.0', '1.23.3']);
    });

    test('honours a lower bound and multiple ranges in one item', async () => {
      const componentId = await seedComponent('range-multi', ['1.26.4', '1.26.5', '1.30.0', '2.0', '2.26.4', '2.26.5']);

      await postItems([
        {
          componentTypeSlug: TYPE,
          componentSlug: 'range-multi',
          urls: [ADVISORY_URL],
          ranges: [
            { from: null, to: '1.26.4', toInclusive: true },
            { from: '2.0', fromInclusive: true, to: '2.26.5', toInclusive: false },
          ],
        },
      ]);

      expect(await flaggedVersions(componentId, ADVISORY_URL)).toEqual(['1.26.4', '2.0', '2.26.4']);
    });

    test('is idempotent when the same unbounded range is re-sent', async () => {
      const componentId = await seedComponent('range-idempotent', ['1.0']);
      const item = { componentTypeSlug: TYPE, componentSlug: 'range-idempotent', urls: [ADVISORY_URL], ranges: [{ from: null, to: '2.0', toInclusive: false }] };

      await postItems([item]);
      const response = await postItems([item]);

      expect(response.body).toMatchObject({ created: 0, duplicates: 1, rangesCreated: 0, rangesDuplicates: 1 });
      const ranges = await db.query('SELECT * FROM vulnerability_ranges WHERE component_id = ?', [componentId]);
      expect(ranges).toHaveLength(1);
      expect(ranges[0].from_version).toBeNull();
    });

    test('never creates a release, and records the range for an unknown component', async () => {
      const response = await postItems([
        { componentTypeSlug: TYPE, componentSlug: 'range-no-releases', urls: [ADVISORY_URL], ranges: [{ from: null, to: '3.0', toInclusive: false }] },
      ]);

      expect(response.body).toMatchObject({ created: 0, rangesCreated: 1 });
      const [component] = await db.query('SELECT id FROM components WHERE slug = ?', ['range-no-releases']);
      expect(await db.query('SELECT * FROM releases WHERE component_id = ?', [component.id])).toHaveLength(0);
    });

    test('flags a release that arrives after the range', async () => {
      const Release = require('../../src/models/release');
      const componentId = await seedComponent('range-late-release', []);
      await postItems([{ componentTypeSlug: TYPE, componentSlug: 'range-late-release', urls: [ADVISORY_URL], ranges: [{ from: null, to: '1.5', toInclusive: false }] }]);

      const { created } = await Release.resolve(componentId, '1.4.2');
      await Release.findOrCreate(componentId, '1.5');

      expect(created).toBe(true);
      expect(await flaggedVersions(componentId, ADVISORY_URL)).toEqual(['1.4.2']);
    });

    test('does not flag a version that cannot be placed at the bound', async () => {
      const componentId = await seedComponent('range-odd-versions', ['1.7.5-698baaf', '1.7.4-698baaf', 'trunk']);

      await postItems([{ componentTypeSlug: TYPE, componentSlug: 'range-odd-versions', urls: [ADVISORY_URL], ranges: [{ from: null, to: '1.7.5', toInclusive: false }] }]);

      expect(await flaggedVersions(componentId, ADVISORY_URL)).toEqual(['1.7.4-698baaf']);
    });

    test('accepts range and version items in the same batch', async () => {
      const response = await postItems([
        { componentTypeSlug: TYPE, componentSlug: 'range-mixed', urls: [ADVISORY_URL], ranges: [{ from: null, to: '1.0', toInclusive: true }] },
        { componentTypeSlug: TYPE, componentSlug: 'range-mixed', urls: [ADVISORY_URL], version: '0.9' },
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ created: 1, duplicates: 1 });
      const [component] = await db.query('SELECT id FROM components WHERE slug = ?', ['range-mixed']);
      expect(await flaggedVersions(component.id, ADVISORY_URL)).toEqual(['0.9']);
    });

    test.each([
      [{ version: '1.0', ranges: [{ from: null, to: '1.0', toInclusive: true }] }, /either version or ranges/],
      [{}, /version or ranges is required/],
      [{ ranges: [] }, /ranges must be an array/],
      [{ ranges: [{ to: '1.0', toInclusive: true }] }, /both from and to/],
      [{ ranges: [{ from: null, to: '1.0' }] }, /toInclusive must be a boolean/],
      [{ ranges: [{ from: '1.0', to: null }] }, /fromInclusive must be a boolean/],
      [{ ranges: [{ from: null, to: '*', toInclusive: true }] }, /not a recognisable version/],
      [{ ranges: [{ from: '2.0', fromInclusive: true, to: '1.0', toInclusive: true }] }, /Range is empty/],
      [{ ranges: [{ from: '1.0', fromInclusive: true, to: '1.0', toInclusive: false }] }, /Range is empty/],
    ])('rejects an invalid range item %#', async (fields, message) => {
      const response = await postItems([{ componentTypeSlug: TYPE, componentSlug: 'range-invalid', urls: [ADVISORY_URL], ...fields }]);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toMatch(message);
    });
  });

  describe('POST /api/vulnerabilities/bulk per-item validation', () => {
    const TYPE = 'wordpress-plugin';

    test('writes the valid items and reports the invalid ones by index', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [
            { componentTypeSlug: TYPE, componentSlug: 'per-item-ok', version: '1.0.0', urls: ['https://example.test/per-item-ok'] },
            { componentTypeSlug: TYPE, componentSlug: 'per-item-dot', urls: ['https://example.test/per-item-dot'], ranges: [{ from: null, to: '.51.1', toInclusive: false }] },
            {
              componentTypeSlug: TYPE,
              componentSlug: 'per-item-date',
              urls: ['https://example.test/per-item-date'],
              ranges: [{ from: null, to: '47.0(20-11-2023)', toInclusive: true }],
            },
            { componentTypeSlug: 'nonexistent-type', componentSlug: 'per-item-type', version: '1.0.0', urls: ['https://example.test/per-item-type'] },
          ],
        });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(1);
      expect(response.body.errors.map((error) => error.index)).toEqual([1, 2, 3]);
      expect(response.body.errors[0].message).toMatch(/not a recognisable version: \.51\.1/);
      const skipped = await db.query("SELECT * FROM components WHERE slug IN ('per-item-dot', 'per-item-date')");
      expect(skipped).toHaveLength(0);
    });

    test('returns 400 only when no item is valid', async () => {
      const response = await request(app)
        .post('/api/vulnerabilities/bulk')
        .set('X-API-Key', regularApiKey)
        .send({
          items: [{ componentTypeSlug: TYPE, componentSlug: 'per-item-none', urls: ['https://example.test/none'], ranges: [{ from: null, to: 'v.1.1', toInclusive: true }] }],
        });

      expect(response.status).toBe(400);
      expect(response.body.errors).toHaveLength(1);
    });
  });

  describe('POST /api/vulnerabilities/bulk URL length (M19)', () => {
    const TYPE = 'wordpress-plugin';
    const urlOfLength = (length) => `https://example.com/${'a'.repeat(length - 'https://example.com/'.length)}`;

    function postItems(items) {
      return request(app).post('/api/vulnerabilities/bulk').set('X-API-Key', regularApiKey).send({ items });
    }

    /** Lengths of the URLs stored against any release of a component. */
    async function storedUrlLengths(slug) {
      const rows = await db.query(
        'SELECT v.url FROM vulnerabilities v JOIN releases r ON r.id = v.release_id JOIN components c ON c.id = r.component_id WHERE c.slug = ? ORDER BY LENGTH(v.url)',
        [slug]
      );
      return rows.map((row) => row.url.length);
    }

    test('stores a real-world long reference URL and one at the limit intact', async () => {
      const response = await postItems([{ componentTypeSlug: TYPE, componentSlug: 'long-url-version', version: '1.0.0', urls: [urlOfLength(634), urlOfLength(2048)] }]);

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(2);
      expect(await storedUrlLengths('long-url-version')).toEqual([634, 2048]);
    });

    test('rejects a URL one character past the limit', async () => {
      const response = await postItems([{ componentTypeSlug: TYPE, componentSlug: 'long-url-rejected', version: '1.0.0', urls: [urlOfLength(2049)] }]);

      expect(response.status).toBe(400);
      expect(response.body.errors[0].message).toMatch(/Invalid URL/);
    });

    test('deduplicates a repeated long URL', async () => {
      const item = { componentTypeSlug: TYPE, componentSlug: 'long-url-dedup', version: '1.0.0', urls: [urlOfLength(2048)] };

      await postItems([item]);
      const response = await postItems([item]);

      expect(response.body).toMatchObject({ created: 0, duplicates: 1 });
    });

    test('accepts a long URL on a range item', async () => {
      await db.query("INSERT INTO components (slug, component_type_slug, title, description) VALUES ('long-url-range', ?, 'long-url-range', '')", [TYPE]);
      const [component] = await db.query('SELECT id FROM components WHERE slug = ?', ['long-url-range']);
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component.id, '0.5']);

      const response = await postItems([
        { componentTypeSlug: TYPE, componentSlug: 'long-url-range', urls: [urlOfLength(2048)], ranges: [{ from: null, to: '1.0', toInclusive: false }] },
      ]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ created: 1, rangesCreated: 1 });
      const [range] = await db.query('SELECT url FROM vulnerability_ranges WHERE component_id = ?', [component.id]);
      expect(range.url.length).toBe(2048);
    });
  });
});
