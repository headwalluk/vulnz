/**
 * Pagination validation (M17.6)
 *
 * `parseInt(x, 10) || default` was wrong in three quiet ways: it swallowed
 * `limit=0` and `limit=abc` into the default, let `page=-1` reach SQL as a
 * negative OFFSET, and imposed no upper bound at all.
 */

const { resolvePagination, DEFAULT_MAX_PAGE_SIZE } = require('../../src/lib/pagination');

describe('resolvePagination', () => {
  const DEFAULT_LIMIT = 10;

  afterEach(() => {
    delete process.env.API_MAX_PAGE_SIZE;
  });

  it('applies the caller default when nothing is supplied', () => {
    expect(resolvePagination({}, DEFAULT_LIMIT)).toEqual({ page: 1, limit: 10, offset: 0 });
  });

  it('computes the offset from page and limit', () => {
    expect(resolvePagination({ page: '3', limit: '25' }, DEFAULT_LIMIT)).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  it.each([
    ['limit=0', { limit: '0' }, 'Invalid limit'],
    ['limit=abc', { limit: 'abc' }, 'Invalid limit'],
    ['limit=-5', { limit: '-5' }, 'Invalid limit'],
    ['limit=1.5', { limit: '1.5' }, 'Invalid limit'],
    ['limit=10x', { limit: '10x' }, 'Invalid limit'],
    ['page=0', { page: '0' }, 'Invalid page'],
    ['page=-1', { page: '-1' }, 'Invalid page'],
    ['page=abc', { page: 'abc' }, 'Invalid page'],
  ])('rejects %s rather than silently defaulting', (_label, query, expectedError) => {
    const result = resolvePagination(query, DEFAULT_LIMIT);
    expect(result.error).toBeDefined();
    expect(result.error.error).toBe(expectedError);
    expect(result.offset).toBeUndefined();
  });

  it('rejects a limit above the maximum instead of clamping it', () => {
    const result = resolvePagination({ limit: String(DEFAULT_MAX_PAGE_SIZE + 1) }, DEFAULT_LIMIT);
    expect(result.error.error).toBe('Limit too large');
    // The message must name the bound — a caller cannot page sensibly
    // around a limit it has to guess.
    expect(result.error.message).toContain(String(DEFAULT_MAX_PAGE_SIZE));
  });

  it('accepts a limit exactly at the maximum', () => {
    expect(resolvePagination({ limit: String(DEFAULT_MAX_PAGE_SIZE) }, DEFAULT_LIMIT).limit).toBe(DEFAULT_MAX_PAGE_SIZE);
  });

  it('honours API_MAX_PAGE_SIZE', () => {
    process.env.API_MAX_PAGE_SIZE = '25';
    expect(resolvePagination({ limit: '26' }, DEFAULT_LIMIT).error.error).toBe('Limit too large');
    expect(resolvePagination({ limit: '25' }, DEFAULT_LIMIT).limit).toBe(25);
  });

  it('treats an empty string as absent, not as invalid', () => {
    // Express gives `?limit=` as '', which is a caller omitting the value
    // rather than supplying a bad one.
    expect(resolvePagination({ page: '', limit: '' }, DEFAULT_LIMIT)).toEqual({ page: 1, limit: 10, offset: 0 });
  });
});
