/**
 * Patched components (M30): /api/websites/{domain}/patches, and the badge on website, report and weekly email.
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

const mockEmailer = {
  sendVulnerabilityReport: jest.fn().mockResolvedValue(undefined),
  sendMalwareAlert: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../src/lib/email', () => mockEmailer);

// deleteByType() uses MySQL multi-table DELETE, which SQLite cannot parse; swapped as in website-malware.test.js
jest.mock('../../src/models/websiteComponent', () => {
  const actual = jest.requireActual('../../src/models/websiteComponent');
  return {
    ...actual,
    deleteByType: async (websiteId, componentType) => {
      const db = require('../../src/db');
      await db.query(
        `DELETE FROM website_components
         WHERE website_id = ?
           AND release_id IN (SELECT r.id FROM releases r JOIN components c ON r.component_id = c.id WHERE c.component_type_slug = ?)`,
        [websiteId, componentType]
      );
    },
  };
});

const PLUGIN_TYPE = 'wordpress-plugin';
const SITE_DOMAIN = 'patched.example.com';
const PATCHES_PATH = `/api/websites/${SITE_DOMAIN}/patches`;
const VULNERABILITY_URL = 'https://example.test/vuln/premium-forms';
const DISCLAIMER = 'One or more vulnerable components have been patched in place.';

describe('patched components', () => {
  let app;
  let db;
  let adminApiKey;
  let ownerApiKey;
  let strangerApiKey;
  let siteId;

  /** Create a component with one release and install it; returns the release id. */
  async function installComponent(websiteId, slug, version) {
    const componentResult = await db.query('INSERT INTO components (slug, component_type_slug, title) VALUES (?, ?, ?)', [slug, PLUGIN_TYPE, `${slug} title`]);
    const releaseResult = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentResult.insertId, version]);
    await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseResult.insertId]);
    return releaseResult.insertId;
  }

  const markPatched = (body, apiKey = ownerApiKey, domain = SITE_DOMAIN) => request(app).post(`/api/websites/${domain}/patches`).set('X-API-Key', apiKey).send(body);
  const listPatches = (apiKey = ownerApiKey) => request(app).get(PATCHES_PATH).set('X-API-Key', apiKey);
  const syncPlugins = (plugins) => request(app).put(`/api/websites/${SITE_DOMAIN}`).set('X-API-Key', ownerApiKey).send({ 'wordpress-plugins': plugins });
  const pluginOnWebsite = async (slug) => {
    const response = await request(app).get(`/api/websites/${SITE_DOMAIN}`).set('X-API-Key', ownerApiKey);
    return { website: response.body, plugin: response.body['wordpress-plugins'].find((installed) => installed.slug === slug) };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const owner = await createTestUser(db, { username: 'owner@example.com', role: 'user' });
    ownerApiKey = await createTestApiKey(db, owner.id);
    await db.query('UPDATE users SET reporting_weekday = ? WHERE id = ?', ['MON', owner.id]);
    const stranger = await createTestUser(db, { username: 'stranger@example.com', role: 'user' });
    strangerApiKey = await createTestApiKey(db, stranger.id);

    siteId = (await createTestWebsite(db, { domain: SITE_DOMAIN, title: 'Patched Site', user_id: owner.id })).id;
    const vulnerableRelease = await installComponent(siteId, 'premium-forms', '2.0.0');
    await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [vulnerableRelease, VULNERABILITY_URL]);
    await installComponent(siteId, 'clean-plugin', '1.0.0');

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/websites')];
    delete require.cache[require.resolve('../../src/routes/reports')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/websites', require('../../src/routes/websites'));
    app.use('/api/reports', require('../../src/routes/reports'));
  });

  beforeEach(async () => {
    await db.query('DELETE FROM website_component_patches');
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('POST /api/websites/:domain/patches', () => {
    test('marks the installed version as patched, and a repeat keeps the first mark', async () => {
      const first = await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0', is_patched: true, created: true });

      const repeat = await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' }, adminApiKey);
      expect(repeat.status).toBe(200);
      expect(repeat.body.created).toBe(false);

      const listed = await listPatches();
      expect(listed.status).toBe(200);
      expect(listed.body.patches).toHaveLength(1);
      expect(listed.body.patches[0]).toMatchObject({ slug: 'premium-forms', component_type_slug: PLUGIN_TYPE, version: '2.0.0', patched_by: 'owner@example.com' });
      expect(listed.body.patches[0].patched_at).toBeTruthy();
    });

    test('rejects a component that is not installed', async () => {
      const response = await markPatched({ type: PLUGIN_TYPE, slug: 'not-here', version: '1.0.0' });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe('COMPONENT_NOT_INSTALLED');
    });

    test('rejects a version other than the installed one, and says what is installed', async () => {
      const response = await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '1.9.0' });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'VERSION_NOT_INSTALLED', installed_versions: ['2.0.0'] });
    });

    test.each([
      [{ slug: 'premium-forms', version: '2.0.0' }, 'FIELD_REQUIRED'],
      [{ type: 'wordpress-plugins', slug: 'premium-forms', version: '2.0.0' }, 'UNKNOWN_COMPONENT_TYPE'],
      [{ type: PLUGIN_TYPE, version: '2.0.0' }, 'FIELD_REQUIRED'],
      [{ type: PLUGIN_TYPE, slug: 'premium-forms' }, 'FIELD_REQUIRED'],
      [{ type: PLUGIN_TYPE, slug: 'premium-forms', version: '   ' }, 'FIELD_REQUIRED'],
    ])('rejects %j with %s', async (body, code) => {
      const response = await markPatched(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(code);
    });

    test("another account cannot mark or list a site's patches", async () => {
      expect((await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' }, strangerApiKey)).status).toBe(404);
      expect((await listPatches(strangerApiKey)).status).toBe(404);
      expect(await db.query('SELECT * FROM website_component_patches')).toHaveLength(0);
    });
  });

  describe('DELETE /api/websites/:domain/patches/:type/:slug', () => {
    test('removes the mark, then reports nothing to remove', async () => {
      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });

      const removed = await request(app).delete(`${PATCHES_PATH}/${PLUGIN_TYPE}/premium-forms`).set('X-API-Key', ownerApiKey);
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ type: PLUGIN_TYPE, slug: 'premium-forms', removed: 1 });

      const again = await request(app).delete(`${PATCHES_PATH}/${PLUGIN_TYPE}/premium-forms`).set('X-API-Key', ownerApiKey);
      expect(again.status).toBe(404);
      expect(again.body.code).toBe('PATCH_NOT_FOUND');
    });

    test('rejects an unknown component type', async () => {
      const response = await request(app).delete(`${PATCHES_PATH}/plugin/premium-forms`).set('X-API-Key', ownerApiKey);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('UNKNOWN_COMPONENT_TYPE');
    });
  });

  describe('reads', () => {
    test('the website shows the badge and still counts the vulnerability', async () => {
      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });

      const { website, plugin } = await pluginOnWebsite('premium-forms');
      expect(plugin).toMatchObject({ is_patched: true, has_vulnerabilities: true, vulnerabilities: [VULNERABILITY_URL] });
      expect(website['wordpress-plugins'].find((installed) => installed.slug === 'clean-plugin').is_patched).toBe(false);
      expect(website.vulnerability_count).toBe(1);
    });

    test('the site report keeps the component in the vulnerable list, flagged', async () => {
      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });

      const response = await request(app).get(`/api/websites/${SITE_DOMAIN}/report`).set('X-API-Key', ownerApiKey);
      expect(response.status).toBe(200);
      expect(response.body.summary).toMatchObject({ vulnerable_components: 1, patched_components: 1 });
      expect(response.body.components.vulnerable[0]).toMatchObject({ slug: 'premium-forms', is_patched: true });
      expect(response.body.components.vulnerable[0].patched_at).toBeTruthy();
    });

    test('the weekly email shows the badge and the disclaimer only when something is patched', async () => {
      const preview = () => request(app).get('/api/reports/summary-email/preview').query({ username: 'owner@example.com' }).set('X-API-Key', adminApiKey);

      const unpatched = await preview();
      expect(unpatched.status).toBe(200);
      expect(unpatched.body.html).toContain('premium-forms title 2.0.0 (premium-forms)');
      expect(unpatched.body.html).not.toContain('Patched*');
      expect(unpatched.body.html).not.toContain(DISCLAIMER);
      expect(unpatched.body.text).not.toContain(DISCLAIMER);

      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });
      const patched = await preview();
      expect(patched.body.subject).toBe(unpatched.body.subject);
      expect(patched.body.html).toContain('Patched*');
      expect(patched.body.html).toContain(DISCLAIMER);
      expect(patched.body.text).toContain('premium-forms title 2.0.0 (premium-forms) [PATCHED*]');
      expect(patched.body.text).toContain(DISCLAIMER);
    });
  });

  describe('site sync', () => {
    test('a sync reporting the same version keeps the mark', async () => {
      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });

      const synced = await syncPlugins([
        { slug: 'premium-forms', version: '2.0.0' },
        { slug: 'clean-plugin', version: '1.0.0' },
      ]);
      expect(synced.status).toBe(200);
      expect((await pluginOnWebsite('premium-forms')).plugin.is_patched).toBe(true);
    });

    test('an update drops the mark, and rolling back does not bring it back', async () => {
      await markPatched({ type: PLUGIN_TYPE, slug: 'premium-forms', version: '2.0.0' });

      await syncPlugins([
        { slug: 'premium-forms', version: '2.1.0' },
        { slug: 'clean-plugin', version: '1.0.0' },
      ]);
      expect((await pluginOnWebsite('premium-forms')).plugin.is_patched).toBe(false);
      expect((await listPatches()).body.patches).toEqual([]);

      await syncPlugins([
        { slug: 'premium-forms', version: '2.0.0' },
        { slug: 'clean-plugin', version: '1.0.0' },
      ]);
      expect((await pluginOnWebsite('premium-forms')).plugin.is_patched).toBe(false);
    });
  });
});
