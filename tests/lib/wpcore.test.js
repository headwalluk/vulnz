/**
 * WordPress core version sync + classification tests (M12)
 *
 * Covers the stable-check parsing, version classification, and the
 * fail-safe sync behaviour that keeps `wordpress.current_version` and
 * `wordpress.safe_versions` current from api.wordpress.org.
 */

const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const wpcore = require('../../src/lib/wpcore');
const appSetting = require('../../src/models/appSetting');

// A trimmed but faithful stable-check response: one 'latest', a couple of
// branch-tip 'outdated' entries, and older 'insecure' patches that must be
// excluded from the safe set.
const STABLE_CHECK_SAMPLE = {
  '6.9.4': 'insecure',
  '7.0': 'insecure',
  '7.0.1': 'insecure',
  '6.8.5': 'insecure',
  '6.8.6': 'outdated',
  '6.9.5': 'outdated',
  '7.0.2': 'latest',
};

function fakeFetch(status, body) {
  return async () => ({
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  });
}

describe('wpcore.parseStableCheck', () => {
  it('extracts the single latest version and the safe (non-insecure) map', () => {
    const { latest, safeMap } = wpcore.parseStableCheck(STABLE_CHECK_SAMPLE);
    expect(latest).toBe('7.0.2');
    expect(safeMap).toEqual({
      '6.8.6': 'outdated',
      '6.9.5': 'outdated',
      '7.0.2': 'latest',
    });
  });

  it('excludes every insecure entry from the safe map', () => {
    const { safeMap } = wpcore.parseStableCheck(STABLE_CHECK_SAMPLE);
    expect(safeMap).not.toHaveProperty('7.0.1');
    expect(safeMap).not.toHaveProperty('6.9.4');
  });

  it('keeps the highest version if a malformed response marks several as latest', () => {
    const { latest } = wpcore.parseStableCheck({
      '6.9.5': 'latest',
      '7.0.2': 'latest',
    });
    expect(latest).toBe('7.0.2');
  });

  it('returns no latest and an empty map for junk input', () => {
    expect(wpcore.parseStableCheck(null)).toEqual({ latest: null, safeMap: {} });
    expect(wpcore.parseStableCheck('nope')).toEqual({ latest: null, safeMap: {} });
    expect(wpcore.parseStableCheck({})).toEqual({ latest: null, safeMap: {} });
  });

  it('ignores non-version keys', () => {
    const { latest, safeMap } = wpcore.parseStableCheck({
      offers: 'latest',
      '7.0.2': 'latest',
    });
    expect(latest).toBe('7.0.2');
    expect(safeMap).not.toHaveProperty('offers');
  });
});

describe('wpcore.classifyWordPressVersion', () => {
  const info = {
    latest: '7.0.2',
    safeMap: { '6.8.6': 'outdated', '6.9.5': 'outdated', '7.0.2': 'latest' },
  };

  it('classifies the current release as latest', () => {
    expect(wpcore.classifyWordPressVersion('7.0.2', info)).toBe('latest');
  });

  it('classifies a maintained branch-tip as outdated, not insecure', () => {
    expect(wpcore.classifyWordPressVersion('6.9.5', info)).toBe('outdated');
    expect(wpcore.classifyWordPressVersion('6.8.6', info)).toBe('outdated');
  });

  it('classifies a version below latest that is not a branch-tip as insecure', () => {
    expect(wpcore.classifyWordPressVersion('7.0.1', info)).toBe('insecure');
    expect(wpcore.classifyWordPressVersion('6.9.4', info)).toBe('insecure');
    expect(wpcore.classifyWordPressVersion('5.0.0', info)).toBe('insecure');
  });

  it('classifies a version at or ahead of latest as current, not insecure', () => {
    expect(wpcore.classifyWordPressVersion('7.0.3', info)).toBe('current');
    expect(wpcore.classifyWordPressVersion('7.1', info)).toBe('current');
  });

  it('returns unknown for unparseable version strings', () => {
    expect(wpcore.classifyWordPressVersion('', info)).toBe('unknown');
    expect(wpcore.classifyWordPressVersion('garbage', info)).toBe('unknown');
    expect(wpcore.classifyWordPressVersion(null, info)).toBe('unknown');
    expect(wpcore.classifyWordPressVersion(undefined, info)).toBe('unknown');
  });

  it('handles an empty safe map by falling back to latest comparison', () => {
    const bare = { latest: '7.0.2', safeMap: {} };
    expect(wpcore.classifyWordPressVersion('7.0.2', bare)).toBe('current');
    expect(wpcore.classifyWordPressVersion('6.9.5', bare)).toBe('insecure');
  });
});

describe('wpcore sync + read (against test DB)', () => {
  let db;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  it('persists latest version and safe map on a good response', async () => {
    const result = await wpcore.syncWordPressCoreVersion({
      fetchImpl: fakeFetch(200, STABLE_CHECK_SAMPLE),
    });
    expect(result).toEqual({ ok: true, latest: '7.0.2', safeCount: 3 });

    expect(await appSetting.get('wordpress.current_version')).toBe('7.0.2');
    const info = await wpcore.getWordPressVersionInfo();
    expect(info.latest).toBe('7.0.2');
    expect(info.safeMap['6.9.5']).toBe('outdated');
  });

  it('leaves settings unchanged on a non-200 response', async () => {
    await wpcore.syncWordPressCoreVersion({ fetchImpl: fakeFetch(200, STABLE_CHECK_SAMPLE) });
    const result = await wpcore.syncWordPressCoreVersion({ fetchImpl: fakeFetch(503, null) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('status_503');
    expect(await appSetting.get('wordpress.current_version')).toBe('7.0.2');
  });

  it('leaves settings unchanged on invalid JSON', async () => {
    const result = await wpcore.syncWordPressCoreVersion({
      fetchImpl: fakeFetch(200, new Error('bad json')),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_json');
    expect(await appSetting.get('wordpress.current_version')).toBe('7.0.2');
  });

  it('leaves settings unchanged when no latest version is present', async () => {
    const result = await wpcore.syncWordPressCoreVersion({
      fetchImpl: fakeFetch(200, { '6.9.5': 'outdated', '6.8.6': 'outdated' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_latest');
    expect(await appSetting.get('wordpress.current_version')).toBe('7.0.2');
  });

  it('reports a fetch error without throwing', async () => {
    const result = await wpcore.syncWordPressCoreVersion({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('fetch_error');
  });
});
