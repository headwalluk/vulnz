/**
 * The weekly report's subject names critical sites only when an advisory is rated critical.
 */

const mockSendMail = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: mockSendMail }) }));

const { sendVulnerabilityReport } = require('../../src/lib/email');

describe('weekly report subject', () => {
  const baseData = { username: 'client@example.com', user: {}, totalWebsites: 3, allWebsites: [], vulnerableWebsites: [], recommendedActions: [] };

  beforeEach(() => {
    mockSendMail.mockClear();
  });

  const subjectFor = async (data) => {
    await sendVulnerabilityReport('client@example.com', { ...baseData, ...data });
    return mockSendMail.mock.calls[0][0].subject;
  };

  test('names the critical sites when there are any', async () => {
    const subject = await subjectFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 1, criticalComponents: 1 } });

    expect(subject).toBe('Weekly Vulnerability Report: 1 site(s) with critical vulnerabilities');
  });

  test('says attention required, not critical, when nothing is rated critical', async () => {
    const subject = await subjectFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 0, criticalComponents: 0 } });

    expect(subject).toBe('Weekly Vulnerability Report: Attention Required!');
  });

  test('all clear when nothing is vulnerable', async () => {
    const subject = await subjectFor({ vulnerableWebsitesCount: 0, executiveSummary: { vulnerableWebsites: 0, criticalWebsites: 0, criticalComponents: 0 } });

    expect(subject).toBe('Weekly Vulnerability Report: All Clear');
  });

  test('the body no longer calls every vulnerability critical', async () => {
    await subjectFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 0, criticalComponents: 0 } });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain('2 site(s) have known vulnerabilities.');
    expect(html).not.toContain('have critical vulnerabilities');
  });
});
