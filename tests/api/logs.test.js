/**
 * GET /api/logs is administrator-only: the log maps every account to its routes and source IPs.
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

describe('GET /api/logs', () => {
  let app;
  let db;
  let adminApiKey;
  let customerApiKey;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const customerUser = await createTestUser(db, { username: 'customer@example.com', role: 'user' });
    customerApiKey = await createTestApiKey(db, customerUser.id);

    await db.query('INSERT INTO api_call_logs (username, route, method, ip_address, status_code) VALUES (?, ?, ?, ?, ?)', [
      'other@example.com',
      '/api/websites/secret-client.example',
      'PUT',
      '203.0.113.7',
      200,
    ]);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/logs')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/logs', require('../../src/routes/logs'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('a non-administrator is refused', async () => {
    const response = await request(app).get('/api/logs').set('X-API-Key', customerApiKey);

    expect(response.status).toBe(403);
    expect(response.text).not.toContain('secret-client.example');
  });

  test('an administrator can read the log', async () => {
    const response = await request(app).get('/api/logs').set('X-API-Key', adminApiKey);

    expect(response.status).toBe(200);
    expect(response.body.logs.map((log) => log.route)).toContain('/api/websites/secret-client.example');
  });

  test('limit is capped rather than unbounded', async () => {
    const response = await request(app).get('/api/logs?limit=1000000').set('X-API-Key', adminApiKey);

    expect(response.status).toBe(400);
  });

  test('requires authentication', async () => {
    const response = await request(app).get('/api/logs');

    expect(response.status).toBe(401);
  });
});
