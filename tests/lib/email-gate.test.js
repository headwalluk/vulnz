/**
 * SMTP_ENABLED gates the mail transport itself: with it off, email.js throws before reaching nodemailer.
 */

const mockTransport = {
  sendMail: jest.fn().mockResolvedValue({}),
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
