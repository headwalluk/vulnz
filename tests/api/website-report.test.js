/**
 * GET /api/websites/{domain}/report (M17.13)
 *
 * Runs against the real models, seeded with one of everything the report
 * reads, plus a second site whose data must not leak into the first's report.
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

const PLUGIN_TYPE = 'wordpress-plugin';

describe('GET /api/websites/:domain/report', () => {
  let app;
  let db;
  let adminApiKey;
  let customerApiKey;

  /** Create a component with one release and install it; returns the component id. */
  async function installComponent(websiteId, slug, version, columns = {}) {
    const columnNames = ['slug', 'component_type_slug', 'title', ...Object.keys(columns)];
    const values = [slug, PLUGIN_TYPE, `${slug} title`, ...Object.values(columns)];
    const componentResult = await db.query(`INSERT INTO components (${columnNames.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`, values);
    const componentId = componentResult.insertId;
    const releaseResult = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
    await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseResult.insertId]);
    return { componentId, releaseId: releaseResult.insertId };
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const adminUser = await createTestUser(db, { username: 'agent@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const customerUser = await createTestUser(db, { username: 'customer@example.com', role: 'user' });
    customerApiKey = await createTestApiKey(db, customerUser.id);

    for (const [settingKey, settingValue] of [
      ['wordpress.current_version', '6.8.2'],
      ['php.minimum_version', '8.1'],
      ['plugin.unmaintained_threshold_months', '6'],
      ['plugin.newly_published_threshold_months', '3'],
    ]) {
      await db.query('INSERT OR REPLACE INTO app_settings (setting_key, setting_value, value_type) VALUES (?, ?, ?)', [settingKey, settingValue, 'string']);
    }

    const site = await createTestWebsite(db, {
      domain: 'reported.example.com',
      title: 'Reported Site',
      user_id: customerUser.id,
      wordpress_version: '6.4.2',
      php_version: '8.2.0',
    });
    await db.query("UPDATE websites SET versions_last_checked_at = datetime('now', '-3 days'), meta = ? WHERE id = ?", [JSON.stringify({ Server: 'box-two' }), site.id]);
    const otherSite = await createTestWebsite(db, { domain: 'other.example.com', user_id: adminUser.id, wordpress_version: '6.8.2', php_version: '7.4.33' });

    const vulnerable = await installComponent(site.id, 'leaky-forms', '2.0.0', { latest_version: '2.1.0' });
    await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [vulnerable.releaseId, 'https://example.test/vuln/leaky-forms']);
    await installComponent(site.id, 'backdoored', '1.0.0', { is_malware: 1, malware_summary: 'Injected admin user' });
    await installComponent(site.id, 'pulled-plugin', '3.0.0', { wporg_status_slug: 'closed', wporg_closure_reason_slug: 'security-issue' });
    await installComponent(site.id, 'up-to-date', '5.0.0', { latest_version: '5.0.0' });
    await installComponent(site.id, 'abandoned', '1.2.0', { last_updated: '2020-01-01 00:00:00' });
    const fresh = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const newcomer = await installComponent(site.id, 'newcomer', '0.1.0', { added: fresh });
    await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [otherSite.id, newcomer.releaseId]);

    const eventTypeResult = await db.query('INSERT INTO security_event_types (slug, title) VALUES (?, ?)', ['failed-login', 'Failed login']);
    const eventTypeId = eventTypeResult.insertId;
    const addEvent = (websiteId, sourceIp, daysAgo, countryCode) =>
      db.query(`INSERT INTO security_events (website_id, event_type_id, source_ip, event_datetime, country_code) VALUES (?, ?, ?, datetime('now', '-${daysAgo} days'), ?)`, [
        websiteId,
        eventTypeId,
        sourceIp,
        countryCode,
      ]);
    await addEvent(site.id, '192.0.2.1', 1, 'GB');
    await addEvent(site.id, '192.0.2.1', 2, 'GB');
    await addEvent(site.id, '192.0.2.2', 3, 'US');
    await addEvent(site.id, '192.0.2.3', 20, 'FR');
    await addEvent(otherSite.id, '192.0.2.9', 1, 'DE');

    const addIssue = (websiteId, filePath, severity) =>
      db.query('INSERT INTO file_security_issues (website_id, file_path, issue_type, severity) VALUES (?, ?, ?, ?)', [websiteId, filePath, 'eval', severity]);
    await addIssue(site.id, 'wp-content/plugins/leaky-forms/x.php', 'error');
    await addIssue(site.id, 'wp-content/plugins/leaky-forms/x.php', 'warning');
    await addIssue(site.id, 'wp-content/themes/t/functions.php', 'info');
    await addIssue(otherSite.id, 'wp-config.php', 'error');

    await db.query("INSERT INTO component_changes (website_id, component_id, change_type, new_release_id, changed_at) VALUES (?, ?, ?, ?, datetime('now', '-2 days'))", [
      site.id,
      vulnerable.componentId,
      'added',
      vulnerable.releaseId,
    ]);
    await db.query("INSERT INTO component_changes (website_id, component_id, change_type, new_release_id, changed_at) VALUES (?, ?, ?, ?, datetime('now', '-40 days'))", [
      site.id,
      vulnerable.componentId,
      'added',
      vulnerable.releaseId,
    ]);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/websites')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/websites', require('../../src/routes/websites'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  const getReport = (domain, queryString = '', apiKey = adminApiKey) => request(app).get(`/api/websites/${domain}/report${queryString}`).set('X-API-Key', apiKey);

  test('describes the website, its owner and its freshness', async () => {
    const response = await getReport('reported.example.com');

    expect(response.status).toBe(200);
    expect(response.body.website).toMatchObject({
      domain: 'reported.example.com',
      title: 'Reported Site',
      url: 'https://reported.example.com',
      username: 'customer@example.com',
      is_dev: false,
      server: 'box-two',
      days_since_versions_checked: 3,
    });
    expect(response.body.period.days).toBe(7);
  });

  test("says who receives the owning account's weekly report", async () => {
    const response = await getReport('reported.example.com');

    expect(response.body.website.report_delivery).toMatchObject({ to: 'customer@example.com', to_source: 'username', cc: [], last_logged_report: null });
  });

  test('summarises every section', async () => {
    const response = await getReport('reported.example.com');

    expect(response.body.summary).toEqual({
      component_count: 6,
      vulnerable_components: 1,
      malware_components: 1,
      withdrawn_components: 1,
      components_behind_latest: 1,
      wordpress_outdated: true,
      php_outdated: false,
      file_security_issues: 3,
      security_events: 3,
      component_changes: 1,
      unmaintained_plugins: 1,
      newly_published_plugins: 1,
    });
  });

  test('lists the problem components with what an agent needs to act', async () => {
    const { components } = (await getReport('reported.example.com')).body;

    expect(components.vulnerable).toEqual([
      expect.objectContaining({ slug: 'leaky-forms', version: '2.0.0', latest_version: '2.1.0', vulnerabilities: ['https://example.test/vuln/leaky-forms'] }),
    ]);
    expect(components.malware).toEqual([expect.objectContaining({ slug: 'backdoored', malware_summary: 'Injected admin user' })]);
    expect(components.withdrawn).toEqual([expect.objectContaining({ slug: 'pulled-plugin', wporg_closure_reason: 'security-issue', wporg_closure_is_security_concern: true })]);
    expect(components.behind_latest.map((installed) => installed.slug)).toEqual(['leaky-forms']);
  });

  test('judges WordPress and PHP against the configured versions', async () => {
    const { software } = (await getReport('reported.example.com')).body;

    expect(software.wordpress).toEqual({ installed: '6.4.2', current: '6.8.2', is_outdated: true });
    expect(software.php).toEqual({ installed: '8.2.0', minimum: '8.1', is_outdated: false });
  });

  test('scopes file issues and security events to this website and period', async () => {
    const report = (await getReport('reported.example.com')).body;

    expect(report.file_security_issues.by_severity).toEqual({ error: 1, warning: 1, info: 1 });
    expect(report.file_security_issues.top_files[0]).toMatchObject({ file_path: 'wp-content/plugins/leaky-forms/x.php', issue_count: 2, error_count: 1 });
    expect(report.security_events.by_type).toEqual([{ event_type: 'failed-login', event_count: 3, unique_ips: 2 }]);
    expect(report.security_events.top_countries[0]).toEqual({ country_code: 'GB', event_count: 2 });
    expect(report.security_events.top_countries.map((country) => country.country_code)).not.toContain('DE');
  });

  test('a longer period takes in older events and changes', async () => {
    const report = (await getReport('reported.example.com', '?days=60')).body;

    expect(report.period.days).toBe(60);
    expect(report.summary.security_events).toBe(4);
    expect(report.summary.component_changes).toBe(2);
  });

  test('flags unmaintained and newly published plugins on this site only', async () => {
    const { plugins_to_monitor: pluginsToMonitor } = (await getReport('reported.example.com')).body;

    expect(pluginsToMonitor.unmaintained.map((plugin) => plugin.slug)).toEqual(['abandoned']);
    expect(pluginsToMonitor.newly_published.map((plugin) => plugin.slug)).toEqual(['newcomer']);
    expect(pluginsToMonitor.unmaintained_threshold_months).toBe(6);
  });

  test('accepts the lenient domain forms', async () => {
    const response = await getReport('www.Reported.example.com');

    expect(response.status).toBe(200);
    expect(response.body.website.domain).toBe('reported.example.com');
  });

  test('the owner may read their own report', async () => {
    const response = await getReport('reported.example.com', '', customerApiKey);

    expect(response.status).toBe(200);
  });

  test("a non-administrator cannot read someone else's report", async () => {
    const response = await getReport('other.example.com', '', customerApiKey);

    expect(response.status).toBe(404);
  });

  test.each(['?days=0', '?days=abc', '?days=91'])('rejects %s with 400', async (queryString) => {
    const response = await getReport('reported.example.com', queryString);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid days');
  });

  test('an unknown website is a 404', async () => {
    const response = await getReport('missing.example.com');

    expect(response.status).toBe(404);
  });
});
