/**
 * POST /api/reports/summary-email: a user may only trigger their own report, and naming another user needs send: true.
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

const mockReporting = { sendSummaryEmail: jest.fn().mockResolvedValue(true) };
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
    expect(response.text).toBe('Report sent');
    expect(mockReporting.sendSummaryEmail).toHaveBeenCalledTimes(1);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].username).toBe('customer@example.com');
  });

  test('a request with no body at all sends the caller their own report', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey);

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].id).toBe(customerUser.id);
  });

  test('an account with no websites is told no report was sent', async () => {
    mockReporting.sendSummaryEmail.mockResolvedValueOnce(false);

    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({});

    expect(response.status).toBe(200);
    expect(response.text).toBe('Report not sent: no websites on this account');
  });

  test("a user cannot trigger someone else's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ user_id: otherUser.id, send: true });

    expect(response.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('an administrator naming another user without send: true is refused, and nothing is sent', async () => {
    const byId = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id });
    const byUsername = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'other@example.com' });

    expect(byId.status).toBe(400);
    expect(byId.text).toContain('"send": true');
    expect(byUsername.status).toBe(400);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test("an administrator can send anyone's report with send: true", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, send: true });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].username).toBe('other@example.com');
  });

  test('an administrator can name the user by username', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'other@example.com', send: true });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].id).toBe(otherUser.id);
  });

  test('preview is refused rather than ignored, so it can never fall through to a send', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'other@example.com', preview: true, send: true });

    expect(response.status).toBe(400);
    expect(response.text).toContain('/api/reports/summary-email/preview');
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('send given as anything but true is refused', async () => {
    const isFalse = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ send: false });
    const isString = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, send: 'yes' });

    expect(isFalse.status).toBe(400);
    expect(isString.status).toBe(400);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('an unknown username is a 404 for an administrator', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'nobody@example.com', send: true });

    expect(response.status).toBe(404);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('a user can name themselves by username without send: true', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'customer@example.com' });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].id).toBe(customerUser.id);
  });

  test('a user gets 403 for any other username, whether or not it exists', async () => {
    const existing = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'other@example.com', send: true });
    const missing = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'nobody@example.com', send: true });

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('user_id and username together, an empty username, or a malformed user_id are rejected', async () => {
    const both = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, username: 'other@example.com', send: true });
    const empty = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: '  ', send: true });
    const malformed = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: '3 OR 1=1', send: true });

    expect(both.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });
});
