/**
 * Notifications API Tests
 *
 * Tests for POST /api/notifications/subscription-changed endpoint
 */

const request = require('supertest');
const express = require('express');
const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

// Mock the db module
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Mock fetch for the notification processor (WP pull)
global.fetch = jest.fn();

// Import routes after mocking
const notificationsRoutes = require('../../src/routes/notifications');

describe('Notifications API', () => {
  let app;
  let db;
  let testSiteId;

  const VALID_SECRET = 'test-notify-secret-abc123';

  beforeAll(async () => {
    // Set the env var for notifyAuth middleware
    process.env.VULNZ_NOTIFY_SECRET = VALID_SECRET;

    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Seed a notification site
    const siteResult = await db.query('INSERT INTO notification_sites (site_url, data_secret, ip_allowlist, active) VALUES (?, ?, ?, ?)', [
      'https://vulnz.net',
      'data-secret-123',
      null,
      1,
    ]);
    testSiteId = siteResult.insertId;

    // Seed an inactive site
    await db.query('INSERT INTO notification_sites (site_url, data_secret, ip_allowlist, active) VALUES (?, ?, ?, ?)', [
      'https://disabled.example.com',
      'data-secret-456',
      null,
      0,
    ]);

    // Seed the notification processing mode setting
    await db.query('INSERT OR IGNORE INTO app_settings (setting_key, setting_value, value_type, description, category, is_system) VALUES (?, ?, ?, ?, ?, ?)', [
      'notifications.processing_mode',
      'queue',
      'string',
      'Processing mode',
      'notifications',
      0,
    ]);

    // Build the Express test app
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationsRoutes);
  });

  afterAll(async () => {
    delete process.env.VULNZ_NOTIFY_SECRET;
    await cleanupTestDatabase(db);
  });

  afterEach(() => {
    global.fetch.mockReset();
  });

  describe('POST /api/notifications/subscription-changed', () => {
    // --- Authentication ---

    it('should return 401 without X-Vulnz-Secret header', async () => {
      const response = await request(app).post('/api/notifications/subscription-changed').send({ user_id: 1, site: 'https://vulnz.net', event: 'subscription_created' });
      expect(response.status).toBe(401);
    });

    it('should return 401 with invalid secret', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', 'wrong-secret')
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'subscription_created' });
      expect(response.status).toBe(401);
    });

    it('should accept a valid secret', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1234, site: 'https://vulnz.net', event: 'subscription_created' });
      // Should be 202 (queued) — not 401
      expect(response.status).toBe(202);
    });

    // --- Validation ---

    it('should return 400 if user_id is missing', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ site: 'https://vulnz.net', event: 'subscription_created' });
      expect(response.status).toBe(400);
    });

    it('should return 400 if site is missing', async () => {
      const response = await request(app).post('/api/notifications/subscription-changed').set('X-Vulnz-Secret', VALID_SECRET).send({ user_id: 1, event: 'subscription_created' });
      expect(response.status).toBe(400);
    });

    it('should return 400 if event is missing', async () => {
      const response = await request(app).post('/api/notifications/subscription-changed').set('X-Vulnz-Secret', VALID_SECRET).send({ user_id: 1, site: 'https://vulnz.net' });
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid event type', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'bogus_event' });
      expect(response.status).toBe(400);
    });

    // --- Site lookup ---

    it('should return 422 for an unknown site', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://unknown.example.com', event: 'subscription_created' });
      expect(response.status).toBe(422);
    });

    it('should return 422 for a disabled site', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://disabled.example.com', event: 'subscription_created' });
      expect(response.status).toBe(422);
    });

    // --- Queue mode ---

    it('should return 202 and queue the notification', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 999, site: 'https://vulnz.net', event: 'subscription_created' });

      expect(response.status).toBe(202);
      expect(response.body.status).toBe('queued');
      expect(response.body.queue_id).toBeDefined();
      expect(response.body.user_id).toBe(999);
      expect(response.body.event).toBe('subscription_created');
    });

    it('should create a pending queue entry', async () => {
      await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 888, site: 'https://vulnz.net', event: 'subscription_updated' });

      const rows = await db.query('SELECT * FROM notification_queue WHERE wp_user_id = ? AND event = ?', [888, 'subscription_updated']);
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending');
      expect(rows[0].site_id).toBe(testSiteId);
    });

    // --- All valid event types ---

    it('should accept subscription_created event', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'subscription_created' });
      expect(response.status).toBe(202);
    });

    it('should accept subscription_updated event', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'subscription_updated' });
      expect(response.status).toBe(202);
    });

    it('should accept subscription_status_changed event', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'subscription_status_changed' });
      expect(response.status).toBe(202);
    });

    it('should accept manual event', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'manual' });
      expect(response.status).toBe(202);
    });

    it('should accept resend event', async () => {
      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 1, site: 'https://vulnz.net', event: 'resend' });
      expect(response.status).toBe(202);
    });

    // --- Immediate mode ---

    it('should process immediately when mode is set to immediate', async () => {
      // Switch to immediate mode
      await db.query("UPDATE app_settings SET setting_value = 'immediate' WHERE setting_key = 'notifications.processing_mode'");

      // Mock the WP pull responses + API key push-back
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            user_id: 777,
            email: 'immediate@example.com',
            account_email: 'immediate@example.com',
            display_name: 'Immediate User',
            registered_date: '2026-03-15 10:00:00',
            subscription_id: 100,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            subscription_id: 100,
            user_id: 777,
            account_email: 'immediate@example.com',
            status: 'wc-active',
            status_label: 'Active',
            max_sites: 10,
            renewal_amount: 25.0,
            next_renewal_date: '2026-04-15',
            perpetual: false,
            api_key: null,
            effective_state: 'active',
            created_date: '2026-03-15 10:00:00',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ subscription_id: 100, user_id: 777, api_key: 'vk_new_key' }),
        });

      const response = await request(app)
        .post('/api/notifications/subscription-changed')
        .set('X-Vulnz-Secret', VALID_SECRET)
        .send({ user_id: 777, site: 'https://vulnz.net', event: 'subscription_created' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('processed');

      // Verify user was created
      const users = await db.query('SELECT * FROM users WHERE username = ?', ['immediate@example.com']);
      expect(users.length).toBe(1);

      // Verify subscription was created
      const subs = await db.query('SELECT * FROM user_subscriptions WHERE account_email = ?', ['immediate@example.com']);
      expect(subs.length).toBe(1);
      expect(subs[0].effective_state).toBe('active');
      expect(subs[0].max_sites).toBe(10);

      // Verify API key was provisioned and pushed back
      const keys = await db.query('SELECT * FROM api_keys WHERE user_id = ?', [users[0].id]);
      expect(keys.length).toBe(1);
      expect(global.fetch).toHaveBeenCalledTimes(3); // customer pull + subscription pull + API key push

      // Restore queue mode
      await db.query("UPDATE app_settings SET setting_value = 'queue' WHERE setting_key = 'notifications.processing_mode'");
    });

    // --- Idempotency ---

    it('should handle duplicate notifications without error', async () => {
      const payload = { user_id: 555, site: 'https://vulnz.net', event: 'subscription_updated' };

      const res1 = await request(app).post('/api/notifications/subscription-changed').set('X-Vulnz-Secret', VALID_SECRET).send(payload);

      const res2 = await request(app).post('/api/notifications/subscription-changed').set('X-Vulnz-Secret', VALID_SECRET).send(payload);

      expect(res1.status).toBe(202);
      expect(res2.status).toBe(202);

      // Both should create separate queue entries (idempotent processing on dequeue)
      const rows = await db.query('SELECT * FROM notification_queue WHERE wp_user_id = ? AND event = ?', [555, 'subscription_updated']);
      expect(rows.length).toBe(2);
    });
  });
});
