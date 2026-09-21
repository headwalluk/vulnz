/**
 * Vulnerability ranges reaching a website sync (M18)
 *
 * A site reporting a version VULNZ has never seen creates the release on the
 * PUT path; stored ranges must flag it there, with real models throughout.
 */

const request = require('supertest');
const express = require('express');
const passport = require('passport');
const { createTestDatabase, initializeSchema, createTestUser, createTestApiKey, createTestWebsite, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

jest.mock('../../src/lib/email', () => ({
  sendMalwareAlert: jest.fn().mockResolvedValue(undefined),
  sendVulnerabilityReport: jest.fn().mockResolvedValue(undefined),
}));

// deleteByType() uses MySQL multi-table DELETE, which SQLite cannot parse.
jest.mock('../../src/models/websiteComponent', () => {
  const actual = jest.requireActual('../../src/models/websiteComponent');
  return {
    ...actual,
    deleteByType: async (websiteId, componentType) => {
      const db = require('../../src/db');
      await db.query(
        `DELETE FROM website_components
         WHERE website_id = ?
           AND release_id IN (
             SELECT r.id FROM releases r
             JOIN components c ON r.component_id = c.id
             WHERE c.component_type_slug = ?
           )`,
        [websiteId, componentType]
      );
    },
  };
});

const VulnerabilityRange = require('../../src/models/vulnerabilityRange');

describe('Vulnerability ranges on website sync', () => {
  const ADVISORY_URL = 'https://example.test/advisory/range-site-sync';
  let app;
  let db;
  let adminApiKey;
  let website;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    website = await createTestWebsite(db, { domain: 'ranges.example.com', title: 'Ranges Site', user_id: adminUser.id });

    const componentResult = await db.query("INSERT INTO components (slug, component_type_slug, title) VALUES ('range-site-sync', 'wordpress-plugin', 'range-site-sync')");
    const { range } = VulnerabilityRange.normaliseRange({ from: null, to: '3.0', toInclusive: false });
    await VulnerabilityRange.recordRanges(componentResult.insertId, [ADVISORY_URL], [range]);

    require('../../src/config/passport');

    app = express();
    app.use(express.json());
    app.use(passport.initialize());

    delete require.cache[require.resolve('../../src/routes/websites')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/websites', require('../../src/routes/websites'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  /** Sync one plugin version to the site and return that plugin as the site reports it. */
  async function syncAndRead(version) {
    const putResponse = await request(app)
      .put(`/api/websites/${website.domain}`)
      .set('X-API-Key', adminApiKey)
      .send({ 'wordpress-plugins': [{ slug: 'range-site-sync', version }] });
    expect(putResponse.status).toBe(200);

    const getResponse = await request(app).get(`/api/websites/${website.domain}`).set('X-API-Key', adminApiKey);
    expect(getResponse.status).toBe(200);
    return getResponse.body['wordpress-plugins'].find((plugin) => plugin.slug === 'range-site-sync');
  }

  test('flags a never-seen version inside the range', async () => {
    const plugin = await syncAndRead('2.9.1');

    expect(plugin.has_vulnerabilities).toBe(true);
    expect(plugin.vulnerabilities).toEqual([ADVISORY_URL]);
  });

  test('does not flag the fixed-in version', async () => {
    const plugin = await syncAndRead('3.0');

    expect(plugin.has_vulnerabilities).toBe(false);
  });

  test('flags a pre-release of the fixed-in version, stored exactly as reported', async () => {
    const plugin = await syncAndRead('3.0-beta2');

    expect(plugin.version).toBe('3.0-beta2');
    expect(plugin.has_vulnerabilities).toBe(true);
  });

  describe('components without a usable version', () => {
    /** Sync one plugin, returning the site's recorded version for it, or undefined if it was dropped. */
    async function syncAndFindVersion(slug, versionField) {
      const response = await request(app)
        .put(`/api/websites/${website.domain}`)
        .set('X-API-Key', adminApiKey)
        .send({ 'wordpress-plugins': [{ slug, ...versionField }] });
      expect(response.status).toBe(200);
      const rows = await db.query(
        'SELECT r.version FROM website_components wc JOIN releases r ON r.id = wc.release_id JOIN components c ON c.id = r.component_id WHERE wc.website_id = ? AND c.slug = ?',
        [website.id, slug]
      );
      return rows.length > 0 ? rows[0].version : undefined;
    }

    test('records a plugin reported with an empty version, rather than dropping it', async () => {
      expect(await syncAndFindVersion('no-version-header', { version: '' })).toBe('');
    });

    test('records a plugin reported with no version field at all', async () => {
      expect(await syncAndFindVersion('missing-version-field', {})).toBe('');
    });

    test('records a plugin whose version is too long to store, with a warning', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const version = await syncAndFindVersion('oversized-version', { version: '1.'.repeat(200) });

      expect(version).toBe('');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Recording wordpress-plugin oversized-version with no version'));
      warnSpy.mockRestore();
    });
  });
});
