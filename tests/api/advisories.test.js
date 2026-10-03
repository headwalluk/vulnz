/**
 * Advisory severity (M28 Batch C, C1): written through POST /api/vulnerabilities/bulk,
 * read on the component routes. Runs against the real models; payloads mirror the
 * Wordfence feed's shape.
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

const PLUGIN_TYPE = 'wordpress-plugin';
const WORDFENCE_URL = 'https://www.wordfence.com/threat-intel/vulnerabilities/id/aaaa1111';
const CVE_URL = 'https://www.cve.org/CVERecord?id=CVE-2024-11111';

describe('Advisory severity', () => {
  let app;
  let db;
  let ingestApiKey;

  /** A Wordfence-shaped bulk item for one plugin, affected below fixedIn. */
  const wordfenceItem = (slug, fixedIn, advisory, urls = [WORDFENCE_URL]) => ({
    componentTypeSlug: PLUGIN_TYPE,
    componentSlug: slug,
    urls,
    ranges: [{ from: null, to: fixedIn, toInclusive: false }],
    ...(advisory ? { advisory } : {}),
  });

  const criticalAdvisory = {
    source: 'wordfence',
    external_id: 'aaaa1111',
    title: 'Foobar <= 2.3.1 - Unauthenticated SQL Injection',
    cve: 'CVE-2024-11111',
    cwe: { id: 89, name: 'SQL Injection' },
    cvss: { score: 9.8, rating: 'Critical', vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
    informational: false,
    published_at: '2024-05-01 00:00:00',
    updated_at: '2024-05-03 10:00:00',
    aliases: [CVE_URL],
  };

  const postBulk = (items) => request(app).post('/api/vulnerabilities/bulk').set('X-API-Key', ingestApiKey).send({ items });
  const getComponent = (slug) => request(app).get(`/api/components/${PLUGIN_TYPE}/${slug}`).set('X-API-Key', ingestApiKey);
  const getVersion = (slug, version) => request(app).get(`/api/components/${PLUGIN_TYPE}/${slug}/${version}`).set('X-API-Key', ingestApiKey);

  /** Create a component with releases; returns release ids by version. */
  async function createComponentWithReleases(slug, versions) {
    const component = await db.query('INSERT INTO components (slug, component_type_slug, title) VALUES (?, ?, ?)', [slug, PLUGIN_TYPE, slug]);
    const releaseIds = {};
    for (const version of versions) {
      releaseIds[version] = (await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [component.insertId, version])).insertId;
    }
    return releaseIds;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    const ingestUser = await createTestUser(db, { username: 'ingest@example.com', role: 'ingest' });
    ingestApiKey = await createTestApiKey(db, ingestUser.id);

    require('../../src/config/passport');
    app = express();
    app.use(express.json());
    app.use(passport.initialize());
    delete require.cache[require.resolve('../../src/middleware/auth')];
    delete require.cache[require.resolve('../../src/routes/vulnerabilities')];
    delete require.cache[require.resolve('../../src/routes/components')];
    app.use('/api/vulnerabilities', require('../../src/routes/vulnerabilities'));
    app.use('/api/components', require('../../src/routes/components'));
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('writing', () => {
    test('stores the advisory and links its URLs and aliases', async () => {
      await createComponentWithReleases('foobar', ['2.3.0', '2.3.1', '2.4.0']);

      const response = await postBulk([wordfenceItem('foobar', '2.4.0', criticalAdvisory)]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ advisoriesCreated: 1, advisoriesUpdated: 0 });
      const [advisory] = await db.query('SELECT * FROM advisories WHERE external_id = ?', ['aaaa1111']);
      expect(advisory).toMatchObject({ source_slug: 'wordfence', cve: 'CVE-2024-11111', cwe_id: 89, cvss_rating_slug: 'critical', is_informational: 0 });
      expect(Number(advisory.cvss_score)).toBe(9.8);
      const urls = (await db.query('SELECT url FROM advisory_urls WHERE advisory_id = ? ORDER BY url', [advisory.id])).map((row) => row.url);
      expect(urls).toEqual([CVE_URL, WORDFENCE_URL].sort());
    });

    test('re-posting updates the advisory rather than duplicating it', async () => {
      const response = await postBulk([wordfenceItem('foobar', '2.4.0', { ...criticalAdvisory, cvss: { score: 8.1, rating: 'high' } })]);

      expect(response.body).toMatchObject({ advisoriesCreated: 0, advisoriesUpdated: 1 });
      const rows = await db.query('SELECT cvss_rating_slug FROM advisories WHERE external_id = ?', ['aaaa1111']);
      expect(rows).toEqual([{ cvss_rating_slug: 'high' }]);
      await postBulk([wordfenceItem('foobar', '2.4.0', criticalAdvisory)]);
    });

    test('a score that disagrees with its rating is stored as given', async () => {
      await postBulk([
        wordfenceItem('mismatch', '1.0.0', { source: 'wordfence', external_id: 'mismatch-1', cvss: { score: 9.8, rating: 'high' } }, ['https://example.test/advisory/mismatch']),
      ]);

      const [advisory] = await db.query('SELECT cvss_score, cvss_rating_slug FROM advisories WHERE external_id = ?', ['mismatch-1']);
      expect(advisory.cvss_rating_slug).toBe('high');
      expect(Number(advisory.cvss_score)).toBe(9.8);
    });

    test.each([
      [{ ...criticalAdvisory, source: 'snyk' }, 'UNKNOWN_ADVISORY_SOURCE', 'advisory.source'],
      [{ ...criticalAdvisory, severity: 'high' }, 'UNKNOWN_FIELD', 'advisory.severity'],
      [{ ...criticalAdvisory, external_id: '' }, 'FIELD_REQUIRED', 'advisory.external_id'],
      [{ ...criticalAdvisory, cvss: { score: 11 } }, 'FIELD_INVALID', 'advisory.cvss.score'],
      [{ ...criticalAdvisory, cvss: { rating: 'extreme' } }, 'FIELD_INVALID', 'advisory.cvss.rating'],
      [{ ...criticalAdvisory, cvss: { vector: 'AV:N' } }, 'FIELD_INVALID', 'advisory.cvss.vector'],
      [{ ...criticalAdvisory, cve: 'CVE-24-1' }, 'FIELD_INVALID', 'advisory.cve'],
      [{ ...criticalAdvisory, published_at: 'last Tuesday' }, 'FIELD_INVALID', 'advisory.published_at'],
      [{ ...criticalAdvisory, aliases: ['not a url'] }, 'FIELD_INVALID', 'advisory.aliases'],
      ['not an object', 'FIELD_INVALID', 'advisory'],
    ])('rejects an invalid advisory (%#) with %s on %s, and writes nothing for that item', async (advisory, code, field) => {
      const response = await postBulk([wordfenceItem('rejected-plugin', '1.0.0', advisory)]);

      expect(response.status).toBe(400);
      expect(response.body.errors[0]).toMatchObject({ code, field });
    });

    test('an unknown item field is rejected, not ignored', async () => {
      const response = await postBulk([{ ...wordfenceItem('strict-plugin', '1.0.0'), severity: 'critical' }]);

      expect(response.status).toBe(400);
      expect(response.body.errors[0]).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'severity' });
    });

    test('an item without an advisory still works as before', async () => {
      const response = await postBulk([wordfenceItem('no-advisory', '1.0.0', undefined, ['https://example.test/advisory/none'])]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ advisoriesCreated: 0, advisoriesUpdated: 0 });
    });
  });

  describe('reading', () => {
    test('each release on the component route carries its severity', async () => {
      const response = await getComponent('foobar');

      const byVersion = Object.fromEntries(response.body.releases.map((release) => [release.version, release]));
      expect(byVersion['2.3.1']).toMatchObject({ has_vulnerabilities: true, max_cvss_score: 9.8, max_cvss_rating: 'critical', unrated_vulnerabilities: 0 });
      expect(byVersion['2.4.0']).toMatchObject({ has_vulnerabilities: false, max_cvss_score: null, max_cvss_rating: null, unrated_vulnerabilities: 0 });
    });

    test('the version route lists the advisories', async () => {
      const response = await getVersion('foobar', '2.3.1');

      expect(response.body).toMatchObject({ is_recorded: true, max_cvss_rating: 'critical', unrated_vulnerabilities: 0 });
      expect(response.body.advisories).toEqual([
        expect.objectContaining({ source: 'wordfence', external_id: 'aaaa1111', cve: 'CVE-2024-11111', cvss_score: 9.8, cvss_rating: 'critical', url: WORDFENCE_URL }),
      ]);
      expect(response.body.vulnerabilities.map((vulnerability) => vulnerability.url)).toEqual([WORDFENCE_URL]);
    });

    test('an unrecorded version judged by ranges carries severity too', async () => {
      const response = await getVersion('foobar', '2.2.0');

      expect(response.body).toMatchObject({ is_recorded: false, has_vulnerabilities: true, max_cvss_rating: 'critical' });
    });

    test('a vulnerability no advisory claims reads as unrated, never as low', async () => {
      await createComponentWithReleases('bare', ['1.0.0']);
      await postBulk([wordfenceItem('bare', '2.0.0', undefined, ['https://example.test/advisory/unrated'])]);

      const response = await getVersion('bare', '1.0.0');

      expect(response.body).toMatchObject({ has_vulnerabilities: true, max_cvss_rating: null, max_cvss_score: null, unrated_vulnerabilities: 1, advisories: [] });
    });

    test('a legacy row stored under the CVE link takes the advisory severity through its alias', async () => {
      const releaseIds = await createComponentWithReleases('legacy-plugin', ['1.0.0']);
      await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [releaseIds['1.0.0'], CVE_URL]);

      const response = await getVersion('legacy-plugin', '1.0.0');

      expect(response.body.max_cvss_rating).toBe('critical');
      expect(response.body.advisories[0].url).toBe(CVE_URL);
    });

    test('an informational advisory rates none, whatever the source scored', async () => {
      await createComponentWithReleases('notice-plugin', ['1.0.0']);
      await postBulk([
        wordfenceItem('notice-plugin', '2.0.0', { source: 'wordfence', external_id: 'notice-1', cvss: { score: 5.3, rating: 'medium' }, informational: true }, [
          'https://example.test/advisory/notice',
        ]),
      ]);

      const response = await getVersion('notice-plugin', '1.0.0');

      expect(response.body).toMatchObject({ max_cvss_rating: 'none', unrated_vulnerabilities: 0 });
      expect(response.body.advisories[0]).toMatchObject({ cvss_rating: 'none', is_informational: true });
    });

    test('two advisories on one release: the highest rating wins, both are listed, and an unrated third is counted', async () => {
      await createComponentWithReleases('multi-plugin', ['1.0.0']);
      await postBulk([
        wordfenceItem('multi-plugin', '2.0.0', { source: 'wordfence', external_id: 'multi-low', cvss: { score: 3.1, rating: 'low' } }, ['https://example.test/advisory/multi-low']),
        wordfenceItem('multi-plugin', '2.0.0', { source: 'wordfence', external_id: 'multi-high', cvss: { score: 7.5, rating: 'high' } }, [
          'https://example.test/advisory/multi-high',
        ]),
        wordfenceItem('multi-plugin', '2.0.0', undefined, ['https://example.test/advisory/multi-unrated']),
      ]);

      const response = await getVersion('multi-plugin', '1.0.0');

      expect(response.body).toMatchObject({ max_cvss_rating: 'high', max_cvss_score: 7.5, unrated_vulnerabilities: 1 });
      expect(response.body.advisories.map((advisory) => advisory.external_id)).toEqual(['multi-high', 'multi-low']);
    });
  });
});
