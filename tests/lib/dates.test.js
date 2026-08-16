/**
 * Date-only rendering (M17.7)
 *
 * formatDateOnly() exists because the two database engines hand a DATE
 * column back in different shapes — mysql2 as a JS Date, SQLite as the
 * string it stored — and neither renders correctly without help: the Date
 * stringifies with a time and a timezone the column never had.
 */

const { formatDateOnly } = require('../../src/lib/dates');

describe('formatDateOnly', () => {
  it('renders a Date from the mysql driver as a plain date', () => {
    expect(formatDateOnly(new Date(Date.UTC(2026, 1, 5)))).toBe('2026-02-05');
  });

  it('renders a date string from SQLite unchanged', () => {
    expect(formatDateOnly('2017-11-20')).toBe('2017-11-20');
  });

  it('trims a full timestamp back to the date part', () => {
    expect(formatDateOnly('2024-10-17T00:00:00.000Z')).toBe('2024-10-17');
  });

  it('returns null for an absent value', () => {
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly(undefined)).toBeNull();
    expect(formatDateOnly('')).toBeNull();
  });

  it('returns null rather than a malformed date', () => {
    expect(formatDateOnly('not a date')).toBeNull();
    expect(formatDateOnly(new Date('nonsense'))).toBeNull();
  });
});
