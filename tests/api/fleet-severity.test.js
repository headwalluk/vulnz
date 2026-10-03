/**
 * Fleet-wide severity (M28 Batch C, C4): summary rows, min_severity with its
 * severity_unknown_sites count, sort=severity, /installs, and the component
 * entries of a full website record. Real models over a small fleet with one
 * site of each kind.
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

const PLUGIN_TYPE = 'wordpress-plugin';

describe('Fleet severity', () => {
  let app;
  let db;
  let adminApiKey;
  let advisoryCounter = 0;

  /** A plugin release with one vulnerability per entry: a rating, 'informational', or null for no advisory. */
  async function vulnerableRelease(slug, version, ratings) {
    const component = await db.query('INSERT INTO components (slug, component_type_slug, title) VALUES (?, ?, ?)', [slug, PLUGIN_TYPE, slug]);
    const release = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component.insertId, version]);
    for (const rating of ratings) {
      advisoryCounter++;
      const url = `https://example.test/advisory/${slug}/${advisoryCounter}`;
      await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [release.insertId, url]);
      if (rating !== null) {
        const informational = rating === 'informational';
        const advisory = await db.query('INSERT INTO advisories (source_slug, external_id, title, cvss_score, cvss_rating_slug, is_informational) VALUES (?, ?, ?, ?, ?, ?)', [
          'wordfence',
          `fleet-${advisoryCounter}`,
          `${slug} advisory`,
          informational ? 5.3 : null,
          informational ? 'medium' : rating,
          informational ? 1 : 0,
        ]);
        await db.query('INSERT INTO advisory_urls (advisory_id, url) VALUES (?, ?)', [advisory.insertId, url]);
      }
    }
    return release.insertId;
  }

  async function install(websiteId, releaseId) {
    await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    const adminUser = await createTestUser(db, { username: 'agent@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const clientUser = await createTestUser(db, { username: 'client@example.com', role: 'user' });
    await db.query('UPDATE users SET reporting_cc = ? WHERE id = ?', ['studio@agency.example', clientUser.id]);

    const criticalSite = await createTestWebsite(db, { domain: 'critical.example.com', user_id: clientUser.id });
    const highSite = await createTestWebsite(db, { domain: 'high.example.com', user_id: adminUser.id });
    const noticeSite = await createTestWebsite(db, { domain: 'notice.example.com', user_id: adminUser.id });
    const unratedSite = await createTestWebsite(db, { domain: 'unrated.example.com', user_id: adminUser.id });
    await createTestWebsite(db, { domain: 'clean.example.com', user_id: adminUser.id });

    // critical: one critical plugin and one medium plugin
    await install(criticalSite.id, await vulnerableRelease('rce-plugin', '1.0.0', ['critical']));
    await install(criticalSite.id, await vulnerableRelease('xss-plugin', '1.0.0', ['medium']));
    // high: a plugin with a high advisory and a second vulnerability nobody has rated
    await install(highSite.id, await vulnerableRelease('mixed-plugin', '1.0.0', ['high', null]));
    // notice: only an informational advisory, which rates none
    await install(noticeSite.id, await vulnerableRelease('notice-plugin', '1.0.0', ['informational']));
    // unrated: a vulnerability with no advisory at all
    await install(unratedSite.id, await vulnerableRelease('unknown-plugin', '1.0.0', [null]));

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/middleware/auth')];
    delete require.cache[require.resolve('../../src/routes/websites')];
    delete require.cache[require.resolve('../../src/routes/components')];
    app.use('/api/websites', require('../../src/routes/websites'));
    app.use('/api/components', require('../../src/routes/components'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  const listSites = (queryString) => request(app).get(`/api/websites?${queryString}`).set('X-API-Key', adminApiKey);
  const byDomain = (response) => Object.fromEntries(response.body.websites.map((website) => [website.domain, website]));

  describe('summary rows', () => {
    test('carry the worst rating, per-rating counts and the unrated total', async () => {
      const sites = byDomain(await listSites('summary=true&limit=50'));

      expect(sites['critical.example.com']).toMatchObject({ max_cvss_rating: 'critical', unrated_vulnerabilities: 0 });
      expect(sites['critical.example.com'].severity_counts).toEqual({ critical: 1, high: 0, medium: 1, low: 0, none: 0, unrated: 0 });
      expect(sites['high.example.com']).toMatchObject({ max_cvss_rating: 'high', unrated_vulnerabilities: 1 });
      expect(sites['notice.example.com']).toMatchObject({ max_cvss_rating: 'none' });
      expect(sites['unrated.example.com']).toMatchObject({ max_cvss_rating: null, unrated_vulnerabilities: 1 });
      expect(sites['unrated.example.com'].severity_counts.unrated).toBe(1);
      expect(sites['clean.example.com']).toMatchObject({ max_cvss_rating: null, unrated_vulnerabilities: 0 });
    });

    test('severity counts add up to vulnerability_count on every site', async () => {
      const response = await listSites('summary=true&limit=50');

      for (const website of response.body.websites) {
        const total = Object.values(website.severity_counts).reduce((sum, count) => sum + count, 0);
        expect([website.domain, total]).toEqual([website.domain, website.vulnerability_count]);
      }
    });

    test("carry the owner's reporting CC for the phone list", async () => {
      const sites = byDomain(await listSites('summary=true&limit=50'));

      expect(sites['critical.example.com']).toMatchObject({ username: 'client@example.com', reporting_cc: 'studio@agency.example' });
      expect(sites['high.example.com'].reporting_cc).toBe('');
    });
  });

  describe('min_severity', () => {
    test('critical returns only the critical site, and counts the sites it could not rule out', async () => {
      const response = await listSites('min_severity=critical&summary=true&limit=50');

      expect(response.status).toBe(200);
      expect(response.body.websites.map((website) => website.domain)).toEqual(['critical.example.com']);
      expect(response.body.total).toBe(1);
      // high (rated high, plus an unrated vulnerability) and unrated (nothing rated) might still be critical
      expect(response.body.severity_unknown_sites).toBe(2);
    });

    test('high includes the high site; an informational-only site never matches', async () => {
      const highResponse = await listSites('min_severity=high&summary=true&limit=50');
      const lowResponse = await listSites('min_severity=low&summary=true&limit=50');

      expect(highResponse.body.websites.map((website) => website.domain).sort()).toEqual(['critical.example.com', 'high.example.com']);
      expect(highResponse.body.severity_unknown_sites).toBe(1);
      expect(lowResponse.body.websites.map((website) => website.domain)).not.toContain('notice.example.com');
    });

    test('is absent from the response when not asked for', async () => {
      const response = await listSites('summary=true');

      expect(response.body).not.toHaveProperty('severity_unknown_sites');
    });

    test('rejects an unknown level', async () => {
      const response = await listSites('min_severity=extreme');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unknown min_severity');
    });
  });

  test('sort=severity ranks by worst rating, unrated after every rated site', async () => {
    const response = await listSites('sort=severity&summary=true&limit=50');

    const domains = response.body.websites.map((website) => website.domain);
    expect(domains.slice(0, 3)).toEqual(['critical.example.com', 'high.example.com', 'notice.example.com']);
    expect(domains.slice(3).sort()).toEqual(['clean.example.com', 'unrated.example.com']);
  });

  test('a full website record carries severity on each plugin', async () => {
    const response = await request(app).get('/api/websites/high.example.com').set('X-API-Key', adminApiKey);

    expect(response.body).toMatchObject({ max_cvss_rating: 'high', unrated_vulnerabilities: 1 });
    expect(response.body['wordpress-plugins'][0]).toMatchObject({ slug: 'mixed-plugin', max_cvss_rating: 'high', unrated_vulnerabilities: 1 });
  });

  describe('/installs', () => {
    test('each version carries its severity and advisories', async () => {
      const response = await request(app).get(`/api/components/${PLUGIN_TYPE}/rce-plugin/installs`).set('X-API-Key', adminApiKey);

      expect(response.body.versions[0]).toMatchObject({ version: '1.0.0', max_cvss_rating: 'critical', unrated_vulnerabilities: 0 });
      expect(response.body.versions[0].advisories[0]).toMatchObject({ cvss_rating: 'critical' });
    });

    test('min_severity keeps only versions at or above it, and counts the versions it could not rule out', async () => {
      const kept = await request(app).get(`/api/components/${PLUGIN_TYPE}/mixed-plugin/installs?min_severity=critical`).set('X-API-Key', adminApiKey);
      const unrated = await request(app).get(`/api/components/${PLUGIN_TYPE}/unknown-plugin/installs?min_severity=low`).set('X-API-Key', adminApiKey);

      expect(kept.body.versions).toEqual([]);
      expect(kept.body.site_count).toBe(0);
      expect(kept.body.severity_unknown_versions).toBe(1);
      expect(unrated.body.versions).toEqual([]);
      expect(unrated.body.severity_unknown_versions).toBe(1);
    });
  });
});
