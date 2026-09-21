/**
 * Clean-up of vulnerability rows that stored ranges do not cover (M18.6)
 *
 * Rows are inserted directly, as the pre-ranges ingest left them: one row per
 * advisory, on the range's upper bound.
 */

const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const { classifyRow, reconcileRangeVulnerabilities } = require('../../src/lib/rangeReconcile');

const FIXED_IN_ADVISORY = 'https://example.test/advisory/fixed-in-1.26.7';
const MANUAL_ADVISORY = 'https://example.test/advisory/manual-entry';
const OTHER_PLUGIN_ADVISORY = 'https://example.test/advisory/other-plugin-only';
const TWO_RANGE_ADVISORY = 'https://example.test/advisory/two-ranges';

let db;
let rangeCounter = 0;

async function addComponent(slug) {
  const result = await db.query("INSERT INTO components (slug, component_type_slug, title) VALUES (?, 'wordpress-plugin', ?)", [slug, slug]);
  return result.insertId;
}

async function addRelease(componentId, version) {
  const result = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);
  return result.insertId;
}

async function addVulnerability(releaseId, url) {
  await db.query('INSERT INTO vulnerabilities (release_id, url) VALUES (?, ?)', [releaseId, url]);
}

async function addRange(componentId, url, { from = null, fromInclusive = true, to = null, toInclusive = true }) {
  rangeCounter++;
  await db.query('INSERT INTO vulnerability_ranges (component_id, url, from_version, from_inclusive, to_version, to_inclusive, range_hash) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    componentId,
    url,
    from,
    fromInclusive ? 1 : 0,
    to,
    toInclusive ? 1 : 0,
    `test-hash-${rangeCounter}`,
  ]);
}

/** Versions of a component that still carry a URL, sorted. */
async function flaggedVersions(slug, url) {
  const rows = await db.query(
    'SELECT r.version FROM vulnerabilities v JOIN releases r ON r.id = v.release_id JOIN components c ON c.id = r.component_id WHERE c.slug = ? AND v.url = ? ORDER BY r.version',
    [slug, url]
  );
  return rows.map((row) => row.version);
}

beforeEach(async () => {
  db = await createTestDatabase();
  mockDb.query.mockImplementation((...args) => db.query(...args));
  await initializeSchema(db);

  const updraft = await addComponent('updraft');
  const other = await addComponent('other-plugin');
  const multi = await addComponent('multi-range');

  // "< 1.26.7": materialised rows on 1.23.0 and 1.26.6, plus the old wrong row on 1.26.7
  await addRange(updraft, FIXED_IN_ADVISORY, { to: '1.26.7', toInclusive: false });
  for (const version of ['1.23.0', '1.26.6', '1.26.7', '1.26.7-abc123']) {
    const releaseId = await addRelease(updraft, version);
    await addVulnerability(releaseId, FIXED_IN_ADVISORY);
    if (version === '1.26.7') {
      await addVulnerability(releaseId, MANUAL_ADVISORY);
      await addVulnerability(releaseId, OTHER_PLUGIN_ADVISORY);
    }
  }

  // Ranges for this URL exist only on another component
  await addRange(other, OTHER_PLUGIN_ADVISORY, { to: '1.0', toInclusive: true });

  // Two ranges on one advisory: "<= 1.0" and "2.0 <= v < 2.5"
  await addRange(multi, TWO_RANGE_ADVISORY, { to: '1.0', toInclusive: true });
  await addRange(multi, TWO_RANGE_ADVISORY, { from: '2.0', fromInclusive: true, to: '2.5', toInclusive: false });
  for (const version of ['1.0', '1.5', '2.4', '2.5']) {
    await addVulnerability(await addRelease(multi, version), TWO_RANGE_ADVISORY);
  }
});

afterEach(async () => {
  await cleanupTestDatabase(db);
});

describe('classifyRow', () => {
  const lessThan = (to) => ({ fromVersion: null, fromInclusive: true, toVersion: to, toInclusive: false });

  it('keeps a row any range covers, deletes one every range excludes, and keeps an undecidable one', () => {
    expect(classifyRow('1.26.6', [lessThan('1.26.7')])).toBe('keep');
    expect(classifyRow('1.26.7', [lessThan('1.26.7')])).toBe('delete');
    expect(classifyRow('1.26.7-abc123', [lessThan('1.26.7')])).toBe('undecidable');
    expect(classifyRow('', [lessThan('1.26.7')])).toBe('undecidable');
  });

  it('keeps a release against a bare-letter bound of the same core, rather than guessing a beta', () => {
    const upTo = (to) => ({ fromVersion: null, fromInclusive: true, toVersion: to, toInclusive: true });
    expect(classifyRow('1.0.4', [upTo('1.0.4b')])).toBe('undecidable');
    expect(classifyRow('1.0', [upTo('1.0b')])).toBe('undecidable');
    expect(classifyRow('1.1', [upTo('1.0b')])).toBe('delete');
  });
});

describe('reconcileRangeVulnerabilities', () => {
  test('a dry run reports the rows and deletes nothing', async () => {
    const summary = await reconcileRangeVulnerabilities();

    expect(summary).toMatchObject({ applied: false, componentsWithRanges: 3, rowsChecked: 8, kept: 4, undecidable: 1, toDelete: 3, deleted: 0 });
    expect(summary.deleteSample.map((row) => `${row.slug} ${row.version}`).sort()).toEqual(['multi-range 1.5', 'multi-range 2.5', 'updraft 1.26.7']);
    expect(summary.undecidableSample).toEqual([{ type: 'wordpress-plugin', slug: 'updraft', version: '1.26.7-abc123', url: FIXED_IN_ADVISORY }]);
    expect(summary.byComponent).toEqual([
      { slug: 'multi-range', type: 'wordpress-plugin', toDelete: 2, undecidable: 0 },
      { slug: 'updraft', type: 'wordpress-plugin', toDelete: 1, undecidable: 1 },
    ]);
    expect(await flaggedVersions('updraft', FIXED_IN_ADVISORY)).toEqual(['1.23.0', '1.26.6', '1.26.7', '1.26.7-abc123']);
  });

  test('--apply deletes only the rows the ranges exclude', async () => {
    const summary = await reconcileRangeVulnerabilities({ apply: true });

    expect(summary).toMatchObject({ applied: true, toDelete: 3, deleted: 3 });
    expect(await flaggedVersions('updraft', FIXED_IN_ADVISORY)).toEqual(['1.23.0', '1.26.6', '1.26.7-abc123']);
    expect(await flaggedVersions('multi-range', TWO_RANGE_ADVISORY)).toEqual(['1.0', '2.4']);
    // A URL with no ranges on this component is another source's row.
    expect(await flaggedVersions('updraft', MANUAL_ADVISORY)).toEqual(['1.26.7']);
    // One plugin's ranges never decide another plugin's rows.
    expect(await flaggedVersions('updraft', OTHER_PLUGIN_ADVISORY)).toEqual(['1.26.7']);
  });

  test('running --apply again finds nothing more to delete', async () => {
    await reconcileRangeVulnerabilities({ apply: true });

    const secondRun = await reconcileRangeVulnerabilities({ apply: true });

    expect(secondRun).toMatchObject({ toDelete: 0, deleted: 0, kept: 4, undecidable: 1 });
  });

  test('can be limited to one component', async () => {
    const summary = await reconcileRangeVulnerabilities({ apply: true, componentSlug: 'updraft' });

    expect(summary).toMatchObject({ componentsWithRanges: 1, toDelete: 1, deleted: 1 });
    expect(await flaggedVersions('multi-range', TWO_RANGE_ADVISORY)).toEqual(['1.0', '1.5', '2.4', '2.5']);
  });
});
