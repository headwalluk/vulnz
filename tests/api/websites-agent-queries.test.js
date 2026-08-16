/**
 * Agent query surface on GET /api/websites (M17)
 *
 * Three things are covered here, all of them against the real models rather
 * than mocks — the point of the work is the SQL, so mocking the model would
 * test nothing:
 *
 *   1. The component filter (component_slug / component_type /
 *      component_version) — "which sites are running this plugin".
 *   2. Ranking by vulnerability_count / malware_count, which has to happen
 *      in the database because the route's own counts are derived after
 *      pagination and so can only annotate a page, never order one.
 *   3. That every websites route now writes an api_call_logs row.
 *
 * Owner scoping is asserted alongside each of the first two: an
 * administrator sees every site, and the new filters must not become a way
 * for an ordinary user to learn about someone else's.
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
const THEME_TYPE = 'wordpress-theme';

describe('Websites agent query surface', () => {
  let app;
  let db;
  let adminUser;
  let adminApiKey;
  let customerUser;
  let customerApiKey;

  const sites = {};
  const releases = {};

  /**
   * Create a component with one release, optionally vulnerable or flagged as
   * malware. Returns the release id so it can be installed on a site.
   */
  async function createComponent(slug, { type = PLUGIN_TYPE, version = '1.0.0', vulnerable = false, isMalware = false } = {}) {
    const componentResult = await db.query('INSERT INTO components (slug, component_type_slug, title, is_malware) VALUES (?, ?, ?, ?)', [slug, type, slug, isMalware ? 1 : 0]);
    const componentId = componentResult.insertId;

    const releaseResult = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
    const releaseId = releaseResult.insertId;

    if (vulnerable) {
      await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [releaseId, `https://example.test/vuln/${slug}`]);
    }

    return { componentId, releaseId };
  }

  /** Add a second release to an existing component. */
  async function addRelease(componentId, version) {
    const result = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
    return result.insertId;
  }

  async function install(websiteId, releaseId) {
    await db.query('INSERT OR IGNORE INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
  }

  const domainsOf = (response) => response.body.websites.map((website) => website.domain);

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    adminUser = await createTestUser(db, { username: 'agent@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);

    customerUser = await createTestUser(db, { username: 'customer@example.com', role: 'user' });
    customerApiKey = await createTestApiKey(db, customerUser.id);

    // Websites are created oldest-first, so the default `newest` order is the
    // reverse of this list. siteWorst deliberately sits at the oldest end:
    // if ranking were still happening after pagination, a one-row page would
    // return siteFoobarTwo and the assertions below would catch it.
    sites.worst = await createTestWebsite(db, { domain: 'worst.example.com', title: 'Worst', user_id: adminUser.id });
    sites.infected = await createTestWebsite(db, { domain: 'infected.example.com', title: 'Infected', user_id: adminUser.id });
    sites.clean = await createTestWebsite(db, { domain: 'clean.example.com', title: 'Clean', user_id: adminUser.id });
    sites.customer = await createTestWebsite(db, { domain: 'customer.example.com', title: 'Customer', user_id: customerUser.id });
    sites.upgrading = await createTestWebsite(db, { domain: 'upgrading.example.com', title: 'Upgrading', user_id: adminUser.id });

    const foobar = await createComponent('foobar', { version: '1.0.0' });
    releases.foobarOne = foobar.releaseId;
    releases.foobarTwo = await addRelease(foobar.componentId, '2.0.0');

    // A theme sharing the `foobar` slug: component_type is what separates
    // them, which is why component_type is a filter of its own.
    const foobarTheme = await createComponent('foobar', { type: THEME_TYPE, version: '1.0.0' });
    releases.foobarTheme = foobarTheme.releaseId;

    releases.vulnOne = (await createComponent('vuln-one', { vulnerable: true })).releaseId;
    releases.vulnTwo = (await createComponent('vuln-two', { vulnerable: true })).releaseId;
    releases.vulnTheme = (await createComponent('vuln-theme', { type: THEME_TYPE, vulnerable: true })).releaseId;
    releases.badware = (await createComponent('badware', { isMalware: true })).releaseId;

    // worst: three vulnerable components, one of them a theme
    await install(sites.worst.id, releases.vulnOne);
    await install(sites.worst.id, releases.vulnTwo);
    await install(sites.worst.id, releases.vulnTheme);

    // infected: one vulnerability and one piece of malware
    await install(sites.infected.id, releases.vulnOne);
    await install(sites.infected.id, releases.badware);

    // clean: foobar 1.0.0 and nothing wrong with it
    await install(sites.clean.id, releases.foobarOne);

    // customer: foobar 1.0.0 plus one vulnerability, owned by the non-admin
    await install(sites.customer.id, releases.foobarOne);
    await install(sites.customer.id, releases.vulnOne);

    // upgrading: both foobar releases recorded at once, plus the theme of
    // the same slug — the duplication the GROUP BY has to collapse
    await install(sites.upgrading.id, releases.foobarOne);
    await install(sites.upgrading.id, releases.foobarTwo);
    await install(sites.upgrading.id, releases.foobarTheme);

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

  describe('component filter', () => {
    test('returns only the websites carrying the component', async () => {
      const response = await request(app).get('/api/websites?component_slug=foobar&limit=50').set('X-API-Key', adminApiKey);

      expect(response.status).toBe(200);
      expect(domainsOf(response).sort()).toEqual(['clean.example.com', 'customer.example.com', 'upgrading.example.com']);
      expect(response.body.total).toBe(3);
    });

    test('narrows to a single release when a version is given', async () => {
      const response = await request(app).get('/api/websites?component_slug=foobar&component_version=2.0.0&limit=50').set('X-API-Key', adminApiKey);

      expect(response.status).toBe(200);
      expect(domainsOf(response)).toEqual(['upgrading.example.com']);
      expect(response.body.total).toBe(1);
    });

    test('separates a plugin from a theme of the same slug', async () => {
      const response = await request(app).get(`/api/websites?component_slug=foobar&component_type=${THEME_TYPE}&limit=50`).set('X-API-Key', adminApiKey);

      expect(domainsOf(response)).toEqual(['upgrading.example.com']);
      expect(response.body.total).toBe(1);
    });

    test('lists a website once even when it has several matching releases', async () => {
      const response = await request(app).get('/api/websites?component_slug=foobar&limit=50').set('X-API-Key', adminApiKey);

      const upgrading = domainsOf(response).filter((domain) => domain === 'upgrading.example.com');
      expect(upgrading).toHaveLength(1);
    });

    test('still scopes a non-administrator to their own websites', async () => {
      const response = await request(app).get('/api/websites?component_slug=foobar&limit=50').set('X-API-Key', customerApiKey);

      expect(response.status).toBe(200);
      expect(domainsOf(response)).toEqual(['customer.example.com']);
      expect(response.body.total).toBe(1);
    });

    test('returns an empty list for a component nobody runs', async () => {
      const response = await request(app).get('/api/websites?component_slug=not-installed-anywhere').set('X-API-Key', adminApiKey);

      expect(response.status).toBe(200);
      expect(response.body.websites).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    test('composes with only_vulnerable', async () => {
      const response = await request(app).get('/api/websites?component_slug=foobar&only_vulnerable=true&limit=50').set('X-API-Key', adminApiKey);

      // Of the three foobar sites only the customer's also carries a
      // vulnerability.
      expect(domainsOf(response)).toEqual(['customer.example.com']);
    });
  });

  describe('sorting', () => {
    test('ranks the whole set by vulnerability count, not just the page', async () => {
      const response = await request(app).get('/api/websites?sort=vulnerabilities&limit=1').set('X-API-Key', adminApiKey);

      expect(response.status).toBe(200);
      expect(domainsOf(response)).toEqual(['worst.example.com']);
      expect(response.body.websites[0].vulnerability_count).toBe(3);
    });

    test('orders every site by vulnerability count, breaking ties on malware then recency', async () => {
      const response = await request(app).get('/api/websites?sort=vulnerabilities&limit=50').set('X-API-Key', adminApiKey);

      expect(domainsOf(response)).toEqual([
        'worst.example.com', // 3 vulnerable
        'infected.example.com', // 1 vulnerable, 1 malware
        'customer.example.com', // 1 vulnerable
        'upgrading.example.com', // clean, newer
        'clean.example.com', // clean, older
      ]);
    });

    test('ranks by malware count on request', async () => {
      const response = await request(app).get('/api/websites?sort=malware&limit=1').set('X-API-Key', adminApiKey);

      expect(domainsOf(response)).toEqual(['infected.example.com']);
      expect(response.body.websites[0].malware_count).toBe(1);
    });

    test('defaults to newest first when no sort is given', async () => {
      const response = await request(app).get('/api/websites?limit=1').set('X-API-Key', adminApiKey);

      expect(domainsOf(response)).toEqual(['upgrading.example.com']);
    });

    test('rejects an unknown sort rather than silently using the default', async () => {
      const response = await request(app).get('/api/websites?sort=severity').set('X-API-Key', adminApiKey);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Unknown sort order');
      expect(response.body.message).toContain('vulnerabilities');
    });

    test('sorts within a non-administrator’s own websites only', async () => {
      const response = await request(app).get('/api/websites?sort=vulnerabilities&limit=50').set('X-API-Key', customerApiKey);

      expect(domainsOf(response)).toEqual(['customer.example.com']);
    });
  });

  describe('audit logging', () => {
    /**
     * logApiCall fires its INSERT from inside the res.send override without
     * awaiting it, so the row can land just after supertest resolves.
     */
    async function waitForLogRow(route, method) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const rows = await db.query('SELECT * FROM api_call_logs WHERE route LIKE ? AND method = ? ORDER BY id DESC', [`${route}%`, method]);
        if (rows.length > 0) {
          return rows[0];
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
      return null;
    }

    beforeEach(async () => {
      await db.query('DELETE FROM api_call_logs');
    });

    test('records the caller, route and status for a website listing', async () => {
      await request(app).get('/api/websites?sort=malware').set('X-API-Key', adminApiKey);

      const row = await waitForLogRow('/api/websites', 'GET');
      expect(row).not.toBeNull();
      expect(row.username).toBe('agent@example.com');
      expect(row.status_code).toBe(200);
    });

    test('records a read of a single website', async () => {
      await request(app).get('/api/websites/worst.example.com').set('X-API-Key', adminApiKey);

      const row = await waitForLogRow('/api/websites/worst.example.com', 'GET');
      expect(row).not.toBeNull();
      expect(row.username).toBe('agent@example.com');
    });

    test('records a refused cross-account access attempt', async () => {
      await request(app).get('/api/websites/worst.example.com').set('X-API-Key', customerApiKey);

      const row = await waitForLogRow('/api/websites/worst.example.com', 'GET');
      expect(row).not.toBeNull();
      expect(row.username).toBe('customer@example.com');
      expect(row.status_code).toBe(401);
    });
  });
});
