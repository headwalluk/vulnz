const { normaliseDomainInput, domainCandidates } = require('../../src/lib/domain');

describe('normaliseDomainInput', () => {
  test.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://example.com', 'example.com'],
    ['http://example.com/wp-admin/?page=1#top', 'example.com'],
    ['https://example.com:8443/', 'example.com'],
    ['example.com.', 'example.com'],
    ['https://user:secret@example.com/', 'example.com'],
    ['sub.example.co.uk/path', 'sub.example.co.uk'],
    ['', ''],
  ])('%s -> %s', (rawDomain, expected) => {
    expect(normaliseDomainInput(rawDomain)).toBe(expected);
  });

  test('a non-string yields an empty host', () => {
    expect(normaliseDomainInput(undefined)).toBe('');
  });
});

describe('domainCandidates', () => {
  test('adds www. to a bare host', () => {
    expect(domainCandidates('Example.com')).toEqual(['example.com', 'www.example.com']);
  });

  test('removes www. from a prefixed host', () => {
    expect(domainCandidates('https://www.example.com/')).toEqual(['www.example.com', 'example.com']);
  });

  test('nothing usable yields no candidates', () => {
    expect(domainCandidates('https://')).toEqual([]);
  });
});
