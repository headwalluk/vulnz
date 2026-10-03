/**
 * GET /api/components/{type}/{slug}/installs (M17.12)
 *
 * Runs against the real models: the grouping, the owner scoping and the
 * "never create on read" rule are the behaviour under test.
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

describe('GET /api/components/:type/:slug/installs', () => {
  let app;
  let db;
  let adminApiKey;
  let customerApiKey;

  const installsOf = (slug, queryString = '') => `/api/components/${PLUGIN_TYPE}/${slug}/installs${queryString}`;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'agent@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const customerUser = await createTestUser(db, { username: 'customer@example.com', role: 'user' });
    customerApiKey = await createTestApiKey(db, customerUser.id);

    const alpha = await createTestWebsite(db, { domain: 'alpha.example.com', title: 'Alpha', user_id: adminUser.id });
    await db.query("UPDATE websites SET meta = ?, versions_last_checked_at = datetime('now', '-1 days') WHERE id = ?", [JSON.stringify({ Server: 'box-alpha' }), alpha.id]);
    const bravo = await createTestWebsite(db, { domain: 'bravo.example.com', title: 'Bravo', user_id: adminUser.id, is_dev: 1 });
    const charlie = await createTestWebsite(db, { domain: 'charlie.example.com', title: 'Charlie', user_id: customerUser.id });

    const componentResult = await db.query('INSERT INTO components (slug, component_type_slug, title, latest_version) VALUES (?, ?, ?, ?)', [
      'wpmudev-updates',
      PLUGIN_TYPE,
      'WPMU DEV Dashboard',
      '4.11.30',
    ]);
    const componentId = componentResult.insertId;
    const addRelease = async (version) => (await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version])).insertId;
    const oldRelease = await addRelease('4.11.9');
    const currentRelease = await addRelease('4.11.30');
    await addRelease('4.10.0');

    await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [oldRelease, 'https://example.test/vuln/b']);
    await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [oldRelease, 'https://example.test/vuln/a']);

    const install = (websiteId, releaseId) => db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
    await install(alpha.id, currentRelease);
    await install(bravo.id, oldRelease);
    await install(charlie.id, oldRelease);
    // A site mid-upgrade reports both releases; it must count as one site.
    await install(alpha.id, oldRelease);

    await db.query('INSERT INTO components (slug, component_type_slug, title) VALUES (?, ?, ?)', ['nobody-runs-this', PLUGIN_TYPE, 'Unused']);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/components')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/components', require('../../src/routes/components'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('groups installs by version, newest first, with vulnerabilities and sites', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates')).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(200);
    expect(response.body.component).toMatchObject({ slug: 'wpmudev-updates', latest_version: '4.11.30', is_malware: false });
    expect(response.body.site_count).toBe(3);
    expect(response.body.version_count).toBe(2);

    const [current, old] = response.body.versions;
    expect(current).toMatchObject({ version: '4.11.30', is_latest: true, has_vulnerabilities: false, vulnerabilities: [], site_count: 1 });
    expect(current.sites.map((site) => site.domain)).toEqual(['alpha.example.com']);

    expect(old).toMatchObject({ version: '4.11.9', is_latest: false, has_vulnerabilities: true, site_count: 3 });
    expect(old.vulnerabilities).toEqual(['https://example.test/vuln/a', 'https://example.test/vuln/b']);
    expect(old.sites.map((site) => site.domain)).toEqual(['alpha.example.com', 'bravo.example.com', 'charlie.example.com']);
    expect(old.sites[2]).toMatchObject({ title: 'Charlie', url: 'https://charlie.example.com', username: 'customer@example.com', is_dev: false });
  });

  test('each site carries its self-reported server, or null', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates')).set('X-API-Key', adminApiKey);

    const sites = response.body.versions.flatMap((entry) => entry.sites);
    expect(sites.find((site) => site.domain === 'alpha.example.com').server).toBe('box-alpha');
    expect(sites.find((site) => site.domain === 'bravo.example.com').server).toBeNull();
  });

  test('vulnerable_only keeps only vulnerable versions, and counts only their sites', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates', '?vulnerable_only=true')).set('X-API-Key', adminApiKey);

    expect(response.body.versions.map((entry) => entry.version)).toEqual(['4.11.9']);
    expect(response.body.version_count).toBe(1);
    expect(response.body.site_count).toBe(3);
  });

  test('checked_within_days drops stale and never-reported sites', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates', '?checked_within_days=7')).set('X-API-Key', adminApiKey);

    const domains = response.body.versions.flatMap((entry) => entry.sites.map((site) => site.domain));
    expect([...new Set(domains)]).toEqual(['alpha.example.com']);
    expect(response.body.site_count).toBe(1);
  });

  test.each(['?vulnerable_only=maybe', '?checked_within_days=0'])('rejects %s', async (queryString) => {
    const response = await request(app).get(installsOf('wpmudev-updates', queryString)).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(400);
  });

  test('omits releases nobody has installed', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates')).set('X-API-Key', adminApiKey);

    expect(response.body.versions.map((entry) => entry.version)).not.toContain('4.10.0');
  });

  test('is_dev=false leaves dev sites out', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates', '?is_dev=false')).set('X-API-Key', adminApiKey);

    const domains = response.body.versions.flatMap((entry) => entry.sites.map((site) => site.domain));
    expect(domains).not.toContain('bravo.example.com');
    expect(response.body.site_count).toBe(2);
  });

  test('a non-administrator sees only their own sites', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates')).set('X-API-Key', customerApiKey);

    expect(response.status).toBe(200);
    expect(response.body.site_count).toBe(1);
    expect(response.body.versions).toHaveLength(1);
    expect(response.body.versions[0].sites.map((site) => site.domain)).toEqual(['charlie.example.com']);
  });

  test('a component installed nowhere returns an empty list', async () => {
    const response = await request(app).get(installsOf('nobody-runs-this')).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(200);
    expect(response.body.versions).toEqual([]);
    expect(response.body.site_count).toBe(0);
  });

  test('an unknown component is a 404 and is not created', async () => {
    const response = await request(app).get(installsOf('never-heard-of-it')).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(404);
    const rows = await db.query('SELECT id FROM components WHERE slug = ?', ['never-heard-of-it']);
    expect(rows).toHaveLength(0);
  });

  test('an unknown component type is a 404', async () => {
    const response = await request(app).get('/api/components/wordpress-plugins/wpmudev-updates/installs').set('X-API-Key', adminApiKey);

    expect(response.status).toBe(404);
  });

  test('rejects a malformed is_dev', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates', '?is_dev=maybe')).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid is_dev');
  });

  test('requires authentication', async () => {
    const response = await request(app).get(installsOf('wpmudev-updates'));

    expect(response.status).toBe(401);
  });
});
