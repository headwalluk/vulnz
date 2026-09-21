/**
 * Phantom release detection
 *
 * The pre-1.40.0 rewrite must be reproduced exactly, or the report would
 * miss the rows it created or accuse genuine releases.
 */

const { legacySanitizeVersion, pairWithRewrites } = require('../../src/lib/phantomReleases');

describe('legacySanitizeVersion', () => {
  it.each([
    ['5.0-RC1', '5.01'],
    ['1.0.0-rc.1', '1.0.0.1'],
    ['1.7.5-698baaf', '1.7.5698'],
    ['6.4-beta2', '6.4'],
    ['2026r3', '20263'],
    ['.51.1', '0.51.1'],
    ['1.2.', '1.2.0'],
    ['trunk', '0'],
  ])('rewrites %p to %p, as sanitizeVersion() did', (version, expected) => {
    expect(legacySanitizeVersion(version)).toBe(expected);
  });
});

describe('pairWithRewrites', () => {
  it('pairs a raw release with the rewritten sibling only when that sibling exists', () => {
    const rawReleases = [
      { component_id: 7, version: '3.0.0-beta.1' },
      { component_id: 7, version: '4.0-RC1' },
      { component_id: 8, version: '2.0.0-dev' },
    ];
    const existingKeys = new Set(['7\n3.0.0.1', '7\n3.0.0-beta.1', '7\n4.0-RC1', '8\n2.0.0', '8\n2.0.0-dev']);

    expect(pairWithRewrites(rawReleases, existingKeys)).toEqual([
      { componentId: '7', rawVersion: '3.0.0-beta.1', rewrittenVersion: '3.0.0.1' },
      { componentId: '8', rawVersion: '2.0.0-dev', rewrittenVersion: '2.0.0' },
    ]);
  });
});
