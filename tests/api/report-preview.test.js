/**
 * GET /api/reports/summary-email/preview: renders a user's report as JSON and sends nothing.
 * Runs the real report builder and templates against the SQLite test database; only the mail module is replaced.
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

const PREVIEW_PATH = '/api/reports/summary-email/preview';

describe('GET /api/reports/summary-email/preview', () => {
  let app;
  let db;
  let adminApiKey;
  let clientApiKey;
  let clientId;
  let emptyAccountId;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    clientId = (await createTestUser(db, { username: 'client@example.com', role: 'user' })).id;
    clientApiKey = await createTestApiKey(db, clientId);
    await db.query('UPDATE users SET reporting_weekday = ?, reporting_email = ?, reporting_cc = ? WHERE id = ?', ['MON', 'reports@example.com', 'agency@example.net', clientId]);
    await createTestWebsite(db, { domain: 'client-site.example.com', title: 'Smith &#8211; Sons &amp; Co', user_id: clientId });

    emptyAccountId = (await createTestUser(db, { username: 'empty@example.com', role: 'user' })).id;
    await db.query('UPDATE users SET reporting_weekday = ?, paused = 1 WHERE id = ?', ['TUE', emptyAccountId]);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/reports')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/reports', require('../../src/routes/reports'));
  });

  beforeEach(() => {
    mockEmailer.sendVulnerabilityReport.mockClear();
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('an administrator gets the rendered report by username, and nothing is sent or logged', async () => {
    const [{ count: logsBefore }] = await db.query('SELECT COUNT(*) AS count FROM email_logs');

    const response = await request(app).get(PREVIEW_PATH).query({ username: 'client@example.com' }).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user_id: clientId,
      username: 'client@example.com',
      would_send: true,
      skip_reasons: [],
      delivery: { to: 'reports@example.com', to_source: 'reporting_email', cc: ['agency@example.net'], weekday: 'MON', paused: false, blocked: false },
      subject: 'Weekly Vulnerability Report: All Clear',
    });
    expect(response.body.html).toContain('<!DOCTYPE html>');
    expect(response.body.html).toContain('client-site.example.com');
    expect(new Date(response.body.generated_at).toString()).not.toBe('Invalid Date');

    expect(mockEmailer.sendVulnerabilityReport).not.toHaveBeenCalled();
    const [{ count: logsAfter }] = await db.query('SELECT COUNT(*) AS count FROM email_logs');
    expect(Number(logsAfter)).toBe(Number(logsBefore));
    const [account] = await db.query('SELECT last_summary_sent_at FROM users WHERE id = ?', [clientId]);
    expect(account.last_summary_sent_at).toBeNull();
  });

  test('the text body is plain: no tags, and HTML entities in titles are decoded', async () => {
    const response = await request(app).get(PREVIEW_PATH).query({ user_id: clientId }).set('X-API-Key', adminApiKey);

    expect(response.body.text).not.toMatch(/<[a-z!/]/i);
    expect(response.body.text).toContain('ALL CLEAR');
    expect(response.body.text).toContain('- Smith – Sons & Co (client-site.example.com)');
    expect(response.body.text).not.toContain('&#8211;');
  });

  test('an account the weekly job would skip says why, and with no websites there is no report', async () => {
    const response = await request(app).get(PREVIEW_PATH).query({ user_id: emptyAccountId }).set('X-API-Key', adminApiKey);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ would_send: false, skip_reasons: ['no_websites', 'paused'], subject: null, html: null, text: null });
    expect(response.body.delivery.to).toBe('empty@example.com');
  });

  test('a user can preview their own report with no parameters', async () => {
    const response = await request(app).get(PREVIEW_PATH).set('X-API-Key', clientApiKey);

    expect(response.status).toBe(200);
    expect(response.body.user_id).toBe(clientId);
  });

  test("a user cannot preview someone else's report, and the refusal is JSON", async () => {
    const existing = await request(app).get(PREVIEW_PATH).query({ username: 'empty@example.com' }).set('X-API-Key', clientApiKey);
    const missing = await request(app).get(PREVIEW_PATH).query({ username: 'nobody@example.com' }).set('X-API-Key', clientApiKey);

    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(existing.body).toMatchObject({ error: 'Forbidden' });
  });

  test('errors are JSON: unknown user, conflicting fields, malformed user_id', async () => {
    const unknown = await request(app).get(PREVIEW_PATH).query({ username: 'nobody@example.com' }).set('X-API-Key', adminApiKey);
    const both = await request(app).get(PREVIEW_PATH).query({ user_id: clientId, username: 'client@example.com' }).set('X-API-Key', adminApiKey);
    const malformed = await request(app).get(PREVIEW_PATH).query({ user_id: 'abc' }).set('X-API-Key', adminApiKey);

    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: 'Not found' });
    expect(both.status).toBe(400);
    expect(both.body.message).toMatch(/not both/);
    expect(malformed.status).toBe(400);
  });
});
