/**
 * The weekly report's subject names critical sites only when an advisory is rated critical.
 */

const { renderVulnerabilityReport } = require('../../src/lib/reportRender');

describe('weekly report subject', () => {
  const baseData = { username: 'client@example.com', user: {}, totalWebsites: 3, allWebsites: [], vulnerableWebsites: [], recommendedActions: [] };

  const renderFor = (data) => renderVulnerabilityReport({ ...baseData, ...data });
  const subjectFor = (data) => renderFor(data).subject;

  test('names the critical sites when there are any', () => {
    const subject = subjectFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 1, criticalComponents: 1 } });

    expect(subject).toBe('Weekly Vulnerability Report: 1 site(s) with critical vulnerabilities');
  });

  test('says attention required, not critical, when nothing is rated critical', () => {
    const subject = subjectFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 0, criticalComponents: 0 } });

    expect(subject).toBe('Weekly Vulnerability Report: Attention Required!');
  });

  test('all clear when nothing is vulnerable', () => {
    const subject = subjectFor({ vulnerableWebsitesCount: 0, executiveSummary: { vulnerableWebsites: 0, criticalWebsites: 0, criticalComponents: 0 } });

    expect(subject).toBe('Weekly Vulnerability Report: All Clear');
  });

  test('the body no longer calls every vulnerability critical, in either part', () => {
    const { html, text } = renderFor({ vulnerableWebsitesCount: 2, executiveSummary: { vulnerableWebsites: 2, criticalWebsites: 0, criticalComponents: 0 } });

    expect(html).toContain('2 site(s) have known vulnerabilities.');
    expect(html).not.toContain('have critical vulnerabilities');
    expect(text).toContain('2 site(s) have known vulnerabilities.');
    expect(text).not.toContain('have critical vulnerabilities');
  });
});
