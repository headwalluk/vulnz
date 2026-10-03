/**
 * The weekly report goes to the resolved recipient with the CC list on the same message, and the log records both.
 * An account with no websites is skipped without sending; a preview goes only to the requesting account.
 * Runs the real sendSummaryEmail() against the SQLite test database; only the mail transport is replaced.
 */

const { createTestDatabase, initializeSchema, createTestUser, createTestWebsite, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
};
jest.mock('../../src/db', () => mockDb);

const mockEmailer = {
  sendVulnerabilityReport: jest.fn().mockResolvedValue(undefined),
  sendMalwareAlert: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../../src/lib/email', () => mockEmailer);

const { sendSummaryEmail } = require('../../src/lib/reporting');

describe('sendSummaryEmail with a CC list', () => {
  let db;
  let accountId;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    accountId = (await createTestUser(db, { username: 'client@example.com', role: 'user' })).id;
    await db.query('UPDATE users SET reporting_email = ?, reporting_cc = ? WHERE id = ?', ['reports@example.com', 'agency@example.net, client@example.com, broken', accountId]);
    await createTestWebsite(db, { domain: 'client-site.example.com', user_id: accountId });
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('sends one message with the valid CC addresses, and logs recipient, CC and account', async () => {
    const [account] = await db.query('SELECT * FROM users WHERE id = ?', [accountId]);

    await expect(sendSummaryEmail(account)).resolves.toBe(true);

    expect(mockEmailer.sendVulnerabilityReport).toHaveBeenCalledTimes(1);
    const [to, , cc] = mockEmailer.sendVulnerabilityReport.mock.calls[0];
    expect(to).toBe('reports@example.com');
    // The invalid entry is skipped; the account email is a valid extra copy, not the main recipient
    expect(cc).toEqual(['agency@example.net', 'client@example.com']);

    const [logged] = await db.query('SELECT * FROM email_logs ORDER BY id DESC LIMIT 1');
    expect(logged).toMatchObject({ user_id: accountId, recipient_email: 'reports@example.com', cc_emails: 'agency@example.net, client@example.com', status: 'sent' });
  });

  test('a failed send is logged with the same context, then rethrown', async () => {
    mockEmailer.sendVulnerabilityReport.mockRejectedValueOnce(new Error('SMTP down'));
    const [account] = await db.query('SELECT * FROM users WHERE id = ?', [accountId]);

    await expect(sendSummaryEmail(account)).rejects.toThrow('SMTP down');

    const [logged] = await db.query('SELECT * FROM email_logs ORDER BY id DESC LIMIT 1');
    expect(logged).toMatchObject({ user_id: accountId, status: 'error', cc_emails: 'agency@example.net, client@example.com' });
  });

  test('a preview goes only to the requester, marked as a preview and logged against them', async () => {
    mockEmailer.sendVulnerabilityReport.mockClear();
    const adminId = (await createTestUser(db, { username: 'admin@example.com', role: 'administrator' })).id;
    const [account] = await db.query('SELECT * FROM users WHERE id = ?', [accountId]);
    const [admin] = await db.query('SELECT * FROM users WHERE id = ?', [adminId]);
    const [clientLogsBefore] = await db.query('SELECT COUNT(*) AS count FROM email_logs WHERE user_id = ?', [accountId]);

    await expect(sendSummaryEmail(account, { previewRecipient: admin })).resolves.toBe(true);

    const [to, data, cc, options] = mockEmailer.sendVulnerabilityReport.mock.calls[0];
    expect(to).toBe('admin@example.com');
    expect(cc).toEqual([]);
    expect(options.subjectPrefix).toBe('[Preview for client@example.com] ');
    // The body is the client's report, white-label and all
    expect(data.user.username).toBe('client@example.com');
    expect(data.allWebsites.map((site) => site.domain)).toEqual(['client-site.example.com']);

    const [logged] = await db.query('SELECT * FROM email_logs ORDER BY id DESC LIMIT 1');
    expect(logged).toMatchObject({ user_id: adminId, recipient_email: 'admin@example.com', cc_emails: null, email_type: 'vulnerability_report_preview', status: 'sent' });
    const [clientLogsAfter] = await db.query('SELECT COUNT(*) AS count FROM email_logs WHERE user_id = ?', [accountId]);
    expect(Number(clientLogsAfter.count)).toBe(Number(clientLogsBefore.count));
  });
});

describe('sendSummaryEmail for an account with no websites', () => {
  let db;
  let emptyAccountId;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    emptyAccountId = (await createTestUser(db, { username: 'empty@example.com', role: 'user' })).id;
    const otherAccountId = (await createTestUser(db, { username: 'other@example.com', role: 'user' })).id;
    await createTestWebsite(db, { domain: 'someone-elses-site.example.com', user_id: otherAccountId });
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('sends nothing, logs nothing and returns false', async () => {
    mockEmailer.sendVulnerabilityReport.mockClear();
    const [account] = await db.query('SELECT * FROM users WHERE id = ?', [emptyAccountId]);

    await expect(sendSummaryEmail(account)).resolves.toBe(false);

    expect(mockEmailer.sendVulnerabilityReport).not.toHaveBeenCalled();
    const logged = await db.query('SELECT * FROM email_logs WHERE user_id = ?', [emptyAccountId]);
    expect(logged).toHaveLength(0);
  });
});
