/**
 * POST /api/reports/summary-email: a user may only trigger their own report.
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

const mockReporting = { sendSummaryEmail: jest.fn().mockResolvedValue(undefined) };
jest.mock('../../src/lib/reporting', () => mockReporting);

describe('POST /api/reports/summary-email', () => {
  let app;
  let db;
  let adminApiKey;
  let customerApiKey;
  let customerUser;
  let otherUser;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    customerUser = await createTestUser(db, { username: 'customer@example.com', role: 'user' });
    customerApiKey = await createTestApiKey(db, customerUser.id);
    otherUser = await createTestUser(db, { username: 'other@example.com', role: 'user' });

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/reports')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/reports', require('../../src/routes/reports'));
  });

  beforeEach(() => {
    mockReporting.sendSummaryEmail.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('a user can send their own report', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({});

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail).toHaveBeenCalledTimes(1);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].username).toBe('customer@example.com');
  });

  test("a user cannot trigger someone else's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ user_id: otherUser.id });

    expect(response.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test("an administrator can send anyone's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].username).toBe('other@example.com');
  });
});
