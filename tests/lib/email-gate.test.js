/**
 * SMTP_ENABLED gates the mail transport itself: with it off, email.js throws before reaching nodemailer.
 */

const mockTransport = {
  sendMail: jest.fn().mockResolvedValue({}),
  verify: jest.fn().mockResolvedValue(true),
};
jest.mock('nodemailer', () => ({ createTransport: () => mockTransport }));

const emailer = require('../../src/lib/email');
const { smtpEnabled } = require('../../src/lib/env');

const RENDERED_REPORT = { subject: 'Weekly Vulnerability Report: All Clear', html: '<p>All clear</p>', text: 'All clear' };
const MALWARE_ALERT_DATA = { domain: 'site.example.com', components: [{ slug: 'bad-plugin', type: 'wordpress-plugin', version: '1.0.0' }] };

describe('SMTP_ENABLED', () => {
  afterEach(() => {
    process.env.SMTP_ENABLED = 'true';
    mockTransport.sendMail.mockClear();
  });

  test('is off when unset, and on only for a true value', () => {
    delete process.env.SMTP_ENABLED;
    expect(smtpEnabled()).toBe(false);
    process.env.SMTP_ENABLED = 'nonsense';
    expect(smtpEnabled()).toBe(false);
    process.env.SMTP_ENABLED = 'true';
    expect(smtpEnabled()).toBe(true);
  });

  test('when off, neither email reaches the transport', async () => {
    process.env.SMTP_ENABLED = 'false';

    await expect(emailer.sendVulnerabilityReport('client@example.com', RENDERED_REPORT)).rejects.toThrow('SMTP_ENABLED is off');
    await expect(emailer.sendMalwareAlert('operator@example.com', MALWARE_ALERT_DATA)).rejects.toThrow('SMTP_ENABLED is off');

    expect(mockTransport.sendMail).not.toHaveBeenCalled();
  });

  test('when on, the report is handed to the transport', async () => {
    await emailer.sendVulnerabilityReport('client@example.com', RENDERED_REPORT, ['agency@example.net']);

    expect(mockTransport.sendMail).toHaveBeenCalledTimes(1);
    expect(mockTransport.sendMail.mock.calls[0][0]).toMatchObject({ to: 'client@example.com', cc: ['agency@example.net'], subject: RENDERED_REPORT.subject });
  });
});

describe('sendTestEmail', () => {
  afterEach(() => {
    process.env.SMTP_ENABLED = 'true';
    mockTransport.sendMail.mockReset().mockResolvedValue({});
    mockTransport.verify.mockReset().mockResolvedValue(true);
  });

  test('checks the login, then sends even while SMTP_ENABLED is off', async () => {
    process.env.SMTP_ENABLED = 'false';
    mockTransport.sendMail.mockResolvedValue({ messageId: '<id@example.com>', accepted: ['admin@example.com'], rejected: [], response: '250 OK' });

    const result = await emailer.sendTestEmail('admin@example.com', { version: '9.9.9' });

    expect(mockTransport.verify).toHaveBeenCalledTimes(1);
    expect(mockTransport.sendMail).toHaveBeenCalledTimes(1);
    expect(mockTransport.sendMail.mock.calls[0][0]).toMatchObject({ to: 'admin@example.com', subject: 'VULNZ test email' });
    expect(mockTransport.sendMail.mock.calls[0][0].text).toContain('9.9.9');
    expect(result).toEqual({ messageId: '<id@example.com>', accepted: ['admin@example.com'], rejected: [], response: '250 OK' });
  });

  test('sends nothing when the login check fails', async () => {
    mockTransport.verify.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }));

    await expect(emailer.sendTestEmail('admin@example.com', { version: '9.9.9' })).rejects.toThrow('Invalid login');
    expect(mockTransport.sendMail).not.toHaveBeenCalled();
  });

  test('describeTransport reports whether a password is set, never the password itself', () => {
    const settings = emailer.describeTransport();

    expect(Object.keys(settings).sort()).toEqual(['from', 'host', 'ignoreTls', 'passwordSet', 'port', 'secure', 'smtpEnabled', 'user']);
  });
});
