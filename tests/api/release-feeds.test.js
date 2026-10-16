/**
 * Release feeds (M31): GET /api/release-feeds, POST /api/release-feeds/results,
 * the feed settings validator, the candidates query, and the wordpress.org sync's source stamp.
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
const GITHUB_FEED = 'github-releases';
const HTML_FEED = 'html-llm';
const RANGE_URL = 'https://example.test/vuln/premium-search';

describe('release feeds', () => {
  let app;
  let db;
  let adminApiKey;
  let ingestApiKey;
  let userApiKey;
  let ReleaseFeed;
  let releaseFeeds;

  /** Create a component; returns its id. */
  async function createComponent(slug, columns = {}) {
    const columnNames = ['slug', 'component_type_slug', 'title', ...Object.keys(columns)];
    const values = [slug, PLUGIN_TYPE, `${slug} title`, ...Object.values(columns)];
    const result = await db.query(`INSERT INTO components (${columnNames.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`, values);
    return result.insertId;
  }

  /** Create a component with a feed; returns the component id. */
  async function createFedComponent(slug, { feedType = GITHUB_FEED, params = null, columns = {} } = {}) {
    const componentId = await createComponent(slug, columns);
    await ReleaseFeed.save(componentId, { feedType, feedUrl: `https://example.test/${slug}/releases`, params });
    return componentId;
  }

  const componentRow = async (componentId) => (await db.query('SELECT * FROM components WHERE id = ?', [componentId]))[0];
  const feedRow = async (componentId) => (await db.query('SELECT * FROM component_release_feeds WHERE component_id = ?', [componentId]))[0];
  const releaseRow = async (componentId, version) => (await db.query('SELECT * FROM releases WHERE component_id = ? AND version = ?', [componentId, version]))[0];

  const listFeeds = (queryString = '', apiKey = ingestApiKey) => request(app).get(`/api/release-feeds${queryString}`).set('X-API-Key', apiKey);
  const postResults = (results, apiKey = ingestApiKey) => request(app).post('/api/release-feeds/results').set('X-API-Key', apiKey).send({ results });
  const okResult = (slug, version, extra = {}) => ({ componentTypeSlug: PLUGIN_TYPE, componentSlug: slug, feedType: GITHUB_FEED, status: 'ok', version, ...extra });

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    ReleaseFeed = require('../../src/models/releaseFeed');
    releaseFeeds = require('../../src/lib/releaseFeeds');

    const adminUser = await createTestUser(db, { username: 'admin@example.com', role: 'administrator' });
    adminApiKey = await createTestApiKey(db, adminUser.id);
    const ingestUser = await createTestUser(db, { username: 'ingest@example.com', role: 'ingest' });
    ingestApiKey = await createTestApiKey(db, ingestUser.id);
    const plainUser = await createTestUser(db, { username: 'user@example.com', role: 'user' });
    userApiKey = await createTestApiKey(db, plainUser.id);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/routes/releaseFeeds')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    app.use('/api/release-feeds', require('../../src/routes/releaseFeeds'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('GET /api/release-feeds', () => {
    let checkedId;
    let uncheckedId;

    beforeAll(async () => {
      checkedId = await createFedComponent('list-checked', { params: { repo: 'example/list-checked' } });
      await db.query("UPDATE component_release_feeds SET last_checked_at = datetime('now', '-1 days') WHERE component_id = ?", [checkedId]);
      uncheckedId = await createFedComponent('list-unchecked', { feedType: HTML_FEED, params: { hint: 'Take the Premium number.' } });
      const disabledId = await createFedComponent('list-disabled');
      await ReleaseFeed.setEnabled(disabledId, false);
    });

    test('a user key is refused', async () => {
      const response = await listFeeds('', userApiKey);
      expect(response.status).toBe(403);
    });

    test('lists enabled feeds, never-checked first, with params parsed', async () => {
      const response = await listFeeds();

      expect(response.status).toBe(200);
      const slugs = response.body.feeds.map((feed) => feed.slug);
      expect(slugs.indexOf('list-unchecked')).toBeLessThan(slugs.indexOf('list-checked'));
      expect(slugs).not.toContain('list-disabled');
      const unchecked = response.body.feeds.find((feed) => feed.slug === 'list-unchecked');
      expect(unchecked).toMatchObject({
        component_type_slug: PLUGIN_TYPE,
        feed_type: HTML_FEED,
        feed_url: 'https://example.test/list-unchecked/releases',
        params: { hint: 'Take the Premium number.' },
        is_enabled: true,
        latest_version: null,
        latest_version_source: null,
        last_checked_at: null,
        consecutive_failures: 0,
      });
      expect(unchecked).not.toHaveProperty('component_id');
      expect(response.body.total).toBe(response.body.feeds.length);
      expect(uncheckedId).toBeGreaterThan(checkedId);
    });

    test('include_disabled adds disabled feeds', async () => {
      const response = await listFeeds('?include_disabled=true', adminApiKey);

      expect(response.status).toBe(200);
      expect(response.body.feeds.find((feed) => feed.slug === 'list-disabled')).toMatchObject({ is_enabled: false });
    });

    test('feed_type filters, and an unknown type is a 400', async () => {
      const filtered = await listFeeds(`?feed_type=${HTML_FEED}`);
      expect(filtered.body.feeds.every((feed) => feed.feed_type === HTML_FEED)).toBe(true);
      expect(filtered.body.feeds.map((feed) => feed.slug)).toContain('list-unchecked');

      const unknown = await listFeeds('?feed_type=freemius');
      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe('UNKNOWN_FEED_TYPE');
    });

    test('rejects an invalid include_disabled', async () => {
      const response = await listFeeds('?include_disabled=maybe');
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/release-feeds/results', () => {
    test('a user key is refused', async () => {
      const response = await postResults([okResult('anything', '1.0.0')], userApiKey);
      expect(response.status).toBe(403);
    });

    test.each([
      ['missing', undefined, 'ITEMS_INVALID'],
      ['empty', [], 'ITEMS_INVALID'],
      ['too long', Array.from({ length: 201 }, () => okResult('anything', '1.0.0')), 'TOO_MANY_ITEMS'],
    ])('a %s results array is a 400', async (label, results, code) => {
      const response = await postResults(results);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe(code);
    });

    test('advances a NULL latest_version, applies stored ranges, and stores the details', async () => {
      const componentId = await createFedComponent('premium-search', { columns: { latest_version: null } });
      await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, '2.30.2']);
      await db.query('INSERT INTO vulnerability_ranges (component_id, url, to_version, to_inclusive, range_hash) VALUES (?, ?, ?, ?, ?)', [
        componentId,
        RANGE_URL,
        '2.31',
        1,
        'hash-premium-search',
      ]);

      const response = await postResults([okResult('premium-search', 'v2.31', { releaseDate: '2026-08-07', changelog: '<p>Fixes</p><script>alert(1)</script>' })]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ advanced: 1, unchanged: 0, older: 0, undecidable: 0, failures_recorded: 0, errors: [] });
      expect(response.body.items).toEqual([{ index: 0, outcome: 'advanced', previous_version: null, latest_version: '2.31' }]);
      expect(await componentRow(componentId)).toMatchObject({ latest_version: '2.31', latest_version_source: GITHUB_FEED });
      const release = await releaseRow(componentId, '2.31');
      expect(release).toMatchObject({ release_date: '2026-08-07', changelog: '<p>Fixes</p>' });
      const vulnerabilities = await db.query('SELECT url FROM vulnerabilities WHERE release_id = ?', [release.id]);
      expect(vulnerabilities.map((row) => row.url)).toEqual([RANGE_URL]);
      expect(await feedRow(componentId)).toMatchObject({ last_version_found: '2.31', consecutive_failures: 0, last_error: null });
      expect((await feedRow(componentId)).last_success_at).not.toBeNull();
    });

    test('moves forwards from a stored version and leaves an existing changelog alone', async () => {
      const componentId = await createFedComponent('forward-only', { columns: { latest_version: '1.5.0', latest_version_source: 'wordpressorg' } });
      await db.query('INSERT INTO releases (component_id, version, changelog) VALUES (?, ?, ?)', [componentId, '1.6.0', 'Original notes']);

      const advanced = await postResults([okResult('forward-only', '1.6.0', { changelog: 'Edited notes' })]);
      expect(advanced.body.items[0]).toEqual({ index: 0, outcome: 'advanced', previous_version: '1.5.0', latest_version: '1.6.0' });
      expect((await releaseRow(componentId, '1.6.0')).changelog).toBe('Original notes');

      const unchanged = await postResults([okResult('forward-only', '1.6.0')]);
      expect(unchanged.body).toMatchObject({ unchanged: 1, items: [{ index: 0, outcome: 'unchanged', previous_version: '1.6.0', latest_version: '1.6.0' }] });

      const older = await postResults([okResult('forward-only', '1.4.0')]);
      expect(older.body).toMatchObject({ older: 1, items: [{ index: 0, outcome: 'older', previous_version: '1.6.0', latest_version: '1.6.0' }] });
      expect((await componentRow(componentId)).latest_version).toBe('1.6.0');
      expect(await releaseRow(componentId, '1.4.0')).toBeUndefined();
      // The check itself succeeded, so the feed records what it found
      expect((await feedRow(componentId)).last_version_found).toBe('1.4.0');
    });

    test('an undecidable comparison writes nothing to the component', async () => {
      const componentId = await createFedComponent('odd-suffix', { columns: { latest_version: '3.0.0-build7' } });

      const response = await postResults([okResult('odd-suffix', '3.0.0-build9')]);

      expect(response.body).toMatchObject({ undecidable: 1, items: [{ index: 0, outcome: 'undecidable' }] });
      expect((await componentRow(componentId)).latest_version).toBe('3.0.0-build7');
    });

    test('an error result counts against the feed, and a later success clears it', async () => {
      const componentId = await createFedComponent('flaky-vendor');
      const failure = { componentTypeSlug: PLUGIN_TYPE, componentSlug: 'flaky-vendor', feedType: GITHUB_FEED, status: 'error', error: '<b>HTTP 403</b> from feed' };

      const first = await postResults([failure, failure]);
      expect(first.body).toMatchObject({
        failures_recorded: 2,
        items: [
          { index: 0, outcome: 'failure_recorded' },
          { index: 1, outcome: 'failure_recorded' },
        ],
      });
      expect(await feedRow(componentId)).toMatchObject({ consecutive_failures: 2, last_error: 'HTTP 403 from feed' });
      expect((await feedRow(componentId)).last_success_at).toBeNull();

      await postResults([okResult('flaky-vendor', '1.0.0')]);
      expect(await feedRow(componentId)).toMatchObject({ consecutive_failures: 0, last_error: null });
    });

    test('an unparseable version is rejected and counts as a failure', async () => {
      const componentId = await createFedComponent('garbled-version');

      const response = await postResults([okResult('garbled-version', 'latest')]);

      expect(response.body.items).toEqual([]);
      expect(response.body.errors).toEqual([expect.objectContaining({ index: 0, code: 'UNRECOGNISED_VERSION', field: 'version' })]);
      expect(await feedRow(componentId)).toMatchObject({ consecutive_failures: 1 });
      expect((await componentRow(componentId)).latest_version).toBeNull();
    });

    test('feed lookup errors write nothing', async () => {
      await createComponent('no-feed-here');
      const disabledId = await createFedComponent('switched-off');
      await ReleaseFeed.setEnabled(disabledId, false);
      const retypedId = await createFedComponent('retyped', { feedType: HTML_FEED });

      const response = await postResults([
        okResult('no-feed-here', '1.0.0'),
        okResult('never-heard-of-it', '1.0.0'),
        okResult('switched-off', '1.0.0'),
        okResult('retyped', '1.0.0'),
      ]);

      expect(response.status).toBe(200);
      expect(response.body.errors.map((error) => [error.index, error.code])).toEqual([
        [0, 'FEED_NOT_CONFIGURED'],
        [1, 'FEED_NOT_CONFIGURED'],
        [2, 'FEED_DISABLED'],
        [3, 'FEED_TYPE_MISMATCH'],
      ]);
      expect(await feedRow(retypedId)).toMatchObject({ last_checked_at: null, consecutive_failures: 0 });
      expect((await componentRow(retypedId)).latest_version).toBeNull();
    });

    test.each([
      ['an unknown field', { extra: true }, 'UNKNOWN_FIELD', 'extra'],
      ['a missing version', { version: undefined }, 'FIELD_REQUIRED', 'version'],
      ['a bad status', { status: 'maybe' }, 'FIELD_INVALID', 'status'],
      ['an impossible date', { releaseDate: '2026-02-30' }, 'FIELD_INVALID', 'releaseDate'],
      ['a missing feed type', { feedType: undefined }, 'FIELD_REQUIRED', 'feedType'],
      ['an unknown component type', { componentTypeSlug: 'wordpress-plugni' }, 'UNKNOWN_COMPONENT_TYPE', 'componentTypeSlug'],
    ])('rejects %s and still applies the rest of the batch', async (label, override, code, field) => {
      const componentId = await createFedComponent(`shape-${code.toLowerCase()}-${field.toLowerCase()}`);
      const slug = (await componentRow(componentId)).slug;

      const response = await postResults([{ ...okResult(slug, '1.0.0'), ...override }, okResult(slug, '1.0.0')]);

      expect(response.status).toBe(200);
      expect(response.body.errors).toEqual([expect.objectContaining({ index: 0, code, field })]);
      expect(response.body.items).toEqual([expect.objectContaining({ index: 1, outcome: 'advanced' })]);
    });

    test('an error result without an error message is rejected', async () => {
      await createFedComponent('silent-failure');
      const response = await postResults([{ componentTypeSlug: PLUGIN_TYPE, componentSlug: 'silent-failure', feedType: GITHUB_FEED, status: 'error' }]);
      expect(response.body.errors).toEqual([expect.objectContaining({ code: 'FIELD_REQUIRED', field: 'error' })]);
    });
  });

  describe('ReleaseFeed.save', () => {
    test('a new URL or type clears the status columns; new params alone do not', async () => {
      const componentId = await createFedComponent('moving-target');
      await ReleaseFeed.recordFailure(componentId, 'HTTP 500');

      const paramsOnly = await ReleaseFeed.save(componentId, { feedType: GITHUB_FEED, feedUrl: 'https://example.test/moving-target/releases', params: { repo: 'a/b' } });
      expect(paramsOnly).toEqual({ created: false, statusReset: false });
      expect(await feedRow(componentId)).toMatchObject({ consecutive_failures: 1 });

      const moved = await ReleaseFeed.save(componentId, { feedType: HTML_FEED, feedUrl: 'https://example.test/moving-target/notes', params: null });
      expect(moved).toEqual({ created: false, statusReset: true });
      expect(await feedRow(componentId)).toMatchObject({ consecutive_failures: 0, last_error: null, last_checked_at: null, feed_type_slug: HTML_FEED });
    });
  });

  describe('validateFeedSettings', () => {
    const valid = { feedType: GITHUB_FEED, feedUrl: 'https://api.github.com/repos/example/plugin/releases/latest', params: null };

    test('accepts a known type, an https URL and an object of params', async () => {
      const result = await releaseFeeds.validateFeedSettings({ ...valid, params: '{"item_id": 1234, "license_env": "VENDOR_LICENSE_KEY"}' });
      expect(result).toEqual({ problems: [], params: { item_id: 1234, license_env: 'VENDOR_LICENSE_KEY' } });
    });

    test.each([
      ['an unknown type', { feedType: 'freemius' }, /Unknown feed type/],
      ['an http URL', { feedUrl: 'http://example.test/feed' }, /https:\/\//],
      ['a non-URL', { feedUrl: 'not a url' }, /https:\/\//],
      ['an over-long URL', { feedUrl: `https://example.test/${'a'.repeat(2048)}` }, /2048 characters/],
      ['invalid JSON', { params: '{repo:' }, /not valid JSON/],
      ['a JSON array', { params: '[1, 2]' }, /JSON object/],
      ['a licence key', { params: '{"license_key": "abc123"}' }, /must not hold credentials \(license_key\)/],
      ['a token', { params: '{"token": "abc123"}' }, /must not hold credentials/],
    ])('refuses %s', async (label, override, pattern) => {
      const result = await releaseFeeds.validateFeedSettings({ ...valid, ...override });
      expect(result.problems).toEqual([expect.stringMatching(pattern)]);
    });
  });

  describe('ReleaseFeed.findCandidates', () => {
    test('counts live installs of plugins wordpress.org does not list, without the fed ones by default', async () => {
      const owner = await createTestUser(db, { username: 'designer@example.com', role: 'user' });
      const otherOwner = await createTestUser(db, { username: 'agency@example.com', role: 'user' });
      const sites = [
        await createTestWebsite(db, { domain: 'one.example.com', user_id: owner.id }),
        await createTestWebsite(db, { domain: 'two.example.com', user_id: owner.id }),
        await createTestWebsite(db, { domain: 'three.example.com', user_id: otherOwner.id }),
      ];
      const devSite = await createTestWebsite(db, { domain: 'staging.example.com', user_id: owner.id });
      await db.query('UPDATE websites SET is_dev = 1 WHERE id = ?', [devSite.id]);

      const install = async (componentId, version, websiteIds) => {
        const release = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
        for (const websiteId of websiteIds) {
          await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, release.insertId]);
        }
      };
      const premiumId = await createComponent('candidate-premium', { wporg_available: 0, wporg_status_slug: 'absent' });
      await install(premiumId, '2.30.2', [sites[0].id, sites[1].id]);
      await install(premiumId, '2.29.0', [sites[2].id, devSite.id]);
      const loneId = await createComponent('candidate-lone', { wporg_available: 0 });
      await install(loneId, '1.0.0', [sites[0].id, devSite.id]);
      const publicId = await createComponent('candidate-public', { wporg_available: 1, wporg_status_slug: 'available' });
      await install(publicId, '5.0.0', [sites[0].id, sites[1].id]);
      const fedId = await createComponent('candidate-fed', { wporg_available: 0 });
      await install(fedId, '1.0.0', [sites[0].id, sites[1].id]);
      await ReleaseFeed.save(fedId, { feedType: GITHUB_FEED, feedUrl: 'https://example.test/fed', params: null });

      const options = { componentType: PLUGIN_TYPE, minSites: 2, includeFed: false, limit: 50 };
      const candidates = (await ReleaseFeed.findCandidates(options)).filter((candidate) => candidate.slug.startsWith('candidate-'));
      expect(candidates).toEqual([expect.objectContaining({ slug: 'candidate-premium', site_count: 3, owner_count: 2, wporg_status: 'absent', feed_type: null })]);
      expect(candidates[0].versions.sort()).toEqual(['2.29.0', '2.30.2']);

      const withFed = (await ReleaseFeed.findCandidates({ ...options, includeFed: true })).map((candidate) => candidate.slug);
      expect(withFed).toContain('candidate-fed');
    });
  });

  describe('recordLatestVersion', () => {
    test('stamps wordpressorg as the source', async () => {
      const { recordLatestVersion } = require('../../src/lib/wporg');
      const componentId = await createComponent('directory-plugin');

      await recordLatestVersion(componentId, '4.28.1');

      expect(await componentRow(componentId)).toMatchObject({ latest_version: '4.28.1', latest_version_source: 'wordpressorg' });
    });
  });
});
