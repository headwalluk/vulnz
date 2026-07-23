/**
 * WordPress fast-update manifest route tests (M12)
 *
 * GET /api/wordpress/latest-versions
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

const wordpressRoutes = require('../../src/routes/wordpress');
const appSetting = require('../../src/models/appSetting');

describe('WordPress manifest API', () => {
  let app;
  let db;
  let apiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const user = await createTestUser(db, { username: 'fleet@example.com', role: 'user' });
    apiKey = await createTestApiKey(db, user.id, 'Fleet Key');

    // Two high-priority plugins with captured versions, plus a low-priority
    // one that must not appear, and a high one without a version yet.
    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug, latest_version, latest_version_at, wporg_available) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'woocommerce',
      'wordpress-plugin',
      'WooCommerce',
      'high',
      '10.9.5',
      '2026-07-23 13:04:00',
      1,
    ]);
    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug, latest_version, latest_version_at, wporg_available) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'elementor',
      'wordpress-plugin',
      'Elementor',
      'high',
      '4.2.0',
      '2026-07-23 12:00:00',
      1,
    ]);
    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug, latest_version, wporg_available) VALUES (?, ?, ?, ?, ?, ?)', ['autoptimize', 'wordpress-plugin', 'Autoptimize', 'low', '3.1.0', 1]);
    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug) VALUES (?, ?, ?, ?)', ['pending-plugin', 'wordpress-plugin', 'Pending', 'high']);

    await appSetting.set('wordpress.current_version', '7.0.2', 'string', null, 'versions', true);
    // Pin the core setting's updated_at to a fixed past instant so the
    // freshest data change is a plugin timestamp, not the seed time.
    await db.query("UPDATE app_settings SET updated_at = '2026-07-23 10:00:00' WHERE setting_key = 'wordpress.current_version'");
    await appSetting.set('wporg.watchlist_blind_spots', JSON.stringify(['elementor-pro', 'revslider']), 'string', null, 'sync', false);

    require('../../src/config/passport');

    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    app.use('/api/wordpress', wordpressRoutes);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('requires authentication', async () => {
    await request(app).get('/api/wordpress/latest-versions').expect(401);
  });

  test('returns core version, high-priority plugins with versions, and blind spots', async () => {
    const response = await request(app).get('/api/wordpress/latest-versions').set('X-API-Key', apiKey).expect(200);

    expect(response.body.wordpress_core).toEqual({ latest_version: '7.0.2' });

    const slugs = response.body.plugins.map((plugin) => plugin.slug);
    expect(slugs).toEqual(['elementor', 'woocommerce']); // ordered by slug
    expect(slugs).not.toContain('autoptimize'); // low priority
    expect(slugs).not.toContain('pending-plugin'); // no latest_version yet

    const woo = response.body.plugins.find((plugin) => plugin.slug === 'woocommerce');
    expect(woo.latest_version).toBe('10.9.5');
    expect(woo.checked_at).toBe('2026-07-23T13:04:00.000Z');

    expect(response.body.blind_spots).toEqual(['elementor-pro', 'revslider']);
  });

  test('sets a cache-control header', async () => {
    const response = await request(app).get('/api/wordpress/latest-versions').set('X-API-Key', apiKey).expect(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
  });

  test('generated_at reflects the freshest plugin timestamp', async () => {
    const response = await request(app).get('/api/wordpress/latest-versions').set('X-API-Key', apiKey).expect(200);
    // woocommerce (13:04) is fresher than elementor (12:00)
    expect(response.body.generated_at).toBe('2026-07-23T13:04:00.000Z');
  });
});
