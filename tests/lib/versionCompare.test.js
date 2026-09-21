/**
 * Version comparison (M18)
 *
 * Rules: docs/version-matching.md
 */

const {
  parseVersion,
  compareVersions,
  versionSortCompare,
  isVersionInRange,
  isReleaseAffected,
  preReleaseFinalVersion,
  normaliseReportedVersion,
  validateVersion,
} = require('../../src/lib/versionCompare');

describe('parseVersion', () => {
  it('returns null when there is no numeric core', () => {
    expect(parseVersion('trunk')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('strips a leading v and build metadata', () => {
    expect(parseVersion('v2.2.0')).toMatchObject({ core: ['2', '2', '0'], stageRank: 0 });
    expect(parseVersion('1.0.0+build.5')).toMatchObject({ core: ['1', '0', '0'], stageRank: 0 });
  });

  it('marks an unrecognised suffix with a null stage', () => {
    expect(parseVersion('1.7.5-698baaf').stageRank).toBeNull();
    expect(parseVersion('2026r3').stageRank).toBeNull();
  });
});

describe('compareVersions', () => {
  it.each([
    ['1.26.7', '1.26.6', 1],
    ['1.26.6', '1.26.7', -1],
    ['1.26.7', '1.26.7.0', 0],
    ['2.0', '1.99.99', 1],
    ['1.10', '1.9', 1],
    ['01.2', '1.2', 0],
    ['12345678901234567890.1', '12345678901234567890.0', 1],
    ['v2.2.0', '2.2', 0],
  ])('orders numeric versions: %s vs %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it.each([
    ['6.4-beta2', '6.4', -1],
    ['6.4-beta2', '6.4-beta10', -1],
    ['6.4-alpha', '6.4-beta', -1],
    ['5.0-RC1', '5.0-beta3', 1],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0-dev', '1.0-alpha', -1],
    ['1.2-pl1', '1.2', 1],
    ['5.0-RC1', '4.9', 1],
  ])('orders release stages as PHP version_compare() does: %s vs %s', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it('decides by the numeric core when only one side has an unknown suffix', () => {
    expect(compareVersions('1.7.5-698baaf', '1.7.6')).toBe(-1);
    expect(compareVersions('1.7.5-698baaf', '1.7.4')).toBe(1);
  });

  it('returns null when an unknown suffix meets an equal core', () => {
    expect(compareVersions('1.7.5-698baaf', '1.7.5')).toBeNull();
    expect(compareVersions('2026r3', '2026')).toBeNull();
  });

  it.each([
    ['1.0.4', '1.0.4b'],
    ['0.5', '0.5a'],
    ['1.6.4.0', '1.6.4.b'],
    ['2.1', '2.1p1'],
  ])('treats a bare letter as unrecognised, not as PHP beta/alpha/patch: %s vs %s', (left, right) => {
    expect(compareVersions(left, right)).toBeNull();
  });

  it('still orders a bare-letter version by its numeric core when the cores differ', () => {
    expect(compareVersions('1.0.3', '1.0.4b')).toBe(-1);
    expect(compareVersions('1.0.5', '1.0.4b')).toBe(1);
  });

  it('treats identical unknown suffixes as equal', () => {
    expect(compareVersions('1.7.5-698baaf', '1.7.5-698BAAF')).toBe(0);
  });

  it('returns null when either side has no numeric core', () => {
    expect(compareVersions('trunk', '1.0')).toBeNull();
  });
});

describe('versionSortCompare', () => {
  it('sorts undecidable pairs deterministically', () => {
    const versions = ['1.7.5', '1.7.5-698baaf', '1.10', '1.9', '1.7.5-beta1'];
    versions.sort(versionSortCompare);
    expect(versions).toEqual(['1.7.5-beta1', '1.7.5', '1.7.5-698baaf', '1.9', '1.10']);
  });
});

describe('isVersionInRange', () => {
  const below = (to, toInclusive) => ({ fromVersion: null, fromInclusive: true, toVersion: to, toInclusive });

  it('excludes the fixed-in version of an exclusive upper bound', () => {
    expect(isVersionInRange('1.26.7', below('1.26.7', false))).toBe(false);
    expect(isVersionInRange('1.26.6', below('1.26.7', false))).toBe(true);
    expect(isVersionInRange('1.26.7.0', below('1.26.7', false))).toBe(false);
  });

  it('includes the bound of an inclusive upper bound, and everything below', () => {
    expect(isVersionInRange('1.23.3', below('1.23.3', true))).toBe(true);
    expect(isVersionInRange('1.23.0', below('1.23.3', true))).toBe(true);
    expect(isVersionInRange('0.1', below('1.23.3', true))).toBe(true);
    expect(isVersionInRange('1.23.4', below('1.23.3', true))).toBe(false);
  });

  it('honours a lower bound', () => {
    const premium = { fromVersion: '2.0', fromInclusive: true, toVersion: '2.26.5', toInclusive: false };
    expect(isVersionInRange('1.26.4', premium)).toBe(false);
    expect(isVersionInRange('2.0', premium)).toBe(true);
    expect(isVersionInRange('2.26.4', premium)).toBe(true);
    expect(isVersionInRange('2.26.5', premium)).toBe(false);
    expect(isVersionInRange('2.0', { ...premium, fromInclusive: false })).toBe(false);
  });

  it('counts a pre-release of the fixed-in version as affected', () => {
    expect(isVersionInRange('1.26.7-beta1', below('1.26.7', false))).toBe(true);
  });

  it('matches any version, even an unparseable one, when both sides are unbounded', () => {
    const allVersions = { fromVersion: null, fromInclusive: true, toVersion: null, toInclusive: true };
    expect(isVersionInRange('trunk', allVersions)).toBe(true);
  });

  it('keeps a release undecidable against a bare-letter bound of the same core', () => {
    expect(isVersionInRange('1.0', { fromVersion: null, fromInclusive: true, toVersion: '1.0b', toInclusive: true })).toBeNull();
    expect(isVersionInRange('0.9', { fromVersion: null, fromInclusive: true, toVersion: '1.0b', toInclusive: true })).toBe(true);
  });

  it('returns null only when the undecidable comparison is at a bound', () => {
    expect(isVersionInRange('1.7.5-698baaf', below('1.7.5', false))).toBeNull();
    expect(isVersionInRange('1.7.5-698baaf', below('1.8', false))).toBe(true);
    expect(isVersionInRange('trunk', below('1.8', false))).toBeNull();
  });

  it('returns false when one bound excludes, even if the other is undecidable', () => {
    const range = { fromVersion: '2.0', fromInclusive: true, toVersion: '1.7.5', toInclusive: true };
    expect(isVersionInRange('1.7.5-698baaf', range)).toBe(false);
  });
});

describe('normaliseReportedVersion', () => {
  it('strips tags and whitespace but never rewrites the version', () => {
    expect(normaliseReportedVersion('  <b>1.0.0-rc.1</b> ')).toBe('1.0.0-rc.1');
    expect(normaliseReportedVersion('1.7.5-698baaf')).toBe('1.7.5-698baaf');
    expect(normaliseReportedVersion('trunk')).toBe('trunk');
  });

  it('returns null when nothing usable is left, or it is too long to store', () => {
    expect(normaliseReportedVersion('   ')).toBeNull();
    expect(normaliseReportedVersion('<b></b>')).toBeNull();
    expect(normaliseReportedVersion(undefined)).toBeNull();
    expect(normaliseReportedVersion('1.'.repeat(128))).toBeNull();
  });
});

describe('validateVersion', () => {
  it('accepts versions the comparison rules can parse', () => {
    expect(validateVersion('1.26.7', 'to')).toBeNull();
    expect(validateVersion('6.4-beta2', 'to')).toBeNull();
    expect(validateVersion('v2.2.0', 'to')).toBeNull();
  });

  it.each(['.51.1', '47.0(20-11-2023)', 'v.1.1', '5 alpha 2', '*', ''])('rejects %p', (version) => {
    expect(validateVersion(version, 'to')).toMatch(/^to /);
  });
});

describe('preReleaseFinalVersion', () => {
  it.each([
    ['2.0.0-dev', '2.0.0'],
    ['6.4-beta2', '6.4'],
    ['1.0.0-rc.1', '1.0.0'],
    ['3.0-alpha', '3.0'],
  ])('maps the pre-release %p to %p', (version, expected) => {
    expect(preReleaseFinalVersion(version)).toBe(expected);
  });

  it.each(['2.0.0', '1.2-pl1', '1.0b', '1.7.5-698baaf', 'trunk'])('returns null for %p, which is not a recognised pre-release', (version) => {
    expect(preReleaseFinalVersion(version)).toBeNull();
  });
});

describe('isReleaseAffected', () => {
  const between = (from, to) => ({ fromVersion: from, fromInclusive: true, toVersion: to, toInclusive: true });

  it('flags a pre-release when its final release is affected, even below the lower bound', () => {
    expect(isVersionInRange('2.0.0-beta1', between('2.0.0', '2.5'))).toBe(false);
    expect(isReleaseAffected('2.0.0-beta1', between('2.0.0', '2.5'))).toBe(true);
    expect(isReleaseAffected('2.0.0-dev', between('2.0.0', '2.0.0'))).toBe(true);
  });

  it('never flags a final release because one of its pre-releases is affected', () => {
    const upToBeta = { fromVersion: null, fromInclusive: true, toVersion: '3.0.0-beta.4', toInclusive: true };
    expect(isReleaseAffected('3.0.0-beta.4', upToBeta)).toBe(true);
    expect(isReleaseAffected('3.0.0', upToBeta)).toBe(false);
  });

  it('leaves a pre-release unflagged when neither it nor its final release is affected', () => {
    expect(isReleaseAffected('3.0.0-dev', between('2.0.0', '2.5'))).toBe(false);
  });

  it('agrees with isVersionInRange for anything that is not a recognised pre-release', () => {
    const upTo = { fromVersion: null, fromInclusive: true, toVersion: '1.0b', toInclusive: true };
    expect(isReleaseAffected('1.0', upTo)).toBeNull();
    expect(isReleaseAffected('0.9', upTo)).toBe(true);
    expect(isReleaseAffected('1.7.5-698baaf', { fromVersion: null, fromInclusive: true, toVersion: '1.7.5', toInclusive: false })).toBeNull();
  });
});
