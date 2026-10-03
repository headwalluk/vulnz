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

  test('an account with no websites is told no report was sent', async () => {
    mockReporting.sendSummaryEmail.mockResolvedValueOnce(false);

    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({});

    expect(response.status).toBe(200);
    expect(response.text).toBe('Report not sent: no websites on this account');
  });

  test("a user cannot trigger someone else's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ user_id: otherUser.id });

    expect(response.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test("an administrator can preview someone's report in their own inbox", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, preview: true });

    expect(response.status).toBe(200);
    expect(response.text).toBe('Preview of the report for other@example.com sent to admin@example.com');
    const [reportFor, options] = mockReporting.sendSummaryEmail.mock.calls[0];
    expect(reportFor.username).toBe('other@example.com');
    expect(options.previewRecipient.username).toBe('admin@example.com');
  });

  test("a user cannot preview someone else's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ user_id: otherUser.id, preview: true });

    expect(response.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('a non-boolean preview is rejected', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, preview: 'yes' });

    expect(response.status).toBe(400);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('an administrator can name the user by username', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'other@example.com', preview: true });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].id).toBe(otherUser.id);
  });

  test('an unknown username is a 404 for an administrator', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: 'nobody@example.com' });

    expect(response.status).toBe(404);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('a user can name themselves by username', async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'customer@example.com' });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].id).toBe(customerUser.id);
  });

  test('a user gets 403 for any other username, whether or not it exists', async () => {
    const existing = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'other@example.com' });
    const missing = await request(app).post('/api/reports/summary-email').set('X-API-Key', customerApiKey).send({ username: 'nobody@example.com' });

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test('user_id and username together, or an empty username, are rejected', async () => {
    const both = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id, username: 'other@example.com' });
    const empty = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ username: '  ' });

    expect(both.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(mockReporting.sendSummaryEmail).not.toHaveBeenCalled();
  });

  test("an administrator can send anyone's report", async () => {
    const response = await request(app).post('/api/reports/summary-email').set('X-API-Key', adminApiKey).send({ user_id: otherUser.id });

    expect(response.status).toBe(200);
    expect(mockReporting.sendSummaryEmail.mock.calls[0][0].username).toBe('other@example.com');
    expect(mockReporting.sendSummaryEmail.mock.calls[0][1].previewRecipient).toBeNull();
  });
});
