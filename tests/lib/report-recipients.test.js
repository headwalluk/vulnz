const { parseReportingCc, normaliseReportingCcForStorage, resolveReportDelivery, MAX_REPORTING_CC_ADDRESSES } = require('../../src/lib/reportRecipients');

describe('parseReportingCc', () => {
  test('splits on commas, trims, drops blanks and case-insensitive duplicates', () => {
    expect(parseReportingCc(' a@example.com,, B@example.net , a@EXAMPLE.com ')).toEqual({ addresses: ['a@example.com', 'B@example.net'], invalid: [] });
  });

  test('separates invalid entries', () => {
    expect(parseReportingCc('a@example.com, not-an-email')).toEqual({ addresses: ['a@example.com'], invalid: ['not-an-email'] });
  });

  test.each([null, undefined, ''])('%p yields nothing', (rawCc) => {
    expect(parseReportingCc(rawCc)).toEqual({ addresses: [], invalid: [] });
  });
});

describe('normaliseReportingCcForStorage', () => {
  test('stores a clean, comma-and-space separated list', () => {
    expect(normaliseReportingCcForStorage('a@example.com,b@example.net')).toEqual({ value: 'a@example.com, b@example.net' });
  });

  test.each([null, ''])('%p clears the list', (rawCc) => {
    expect(normaliseReportingCcForStorage(rawCc)).toEqual({ value: '' });
  });

  test('one invalid address rejects the whole list, naming it', () => {
    const result = normaliseReportingCcForStorage('a@example.com, typo@@example');
    expect(result.error.error).toBe('Invalid reporting_cc');
    expect(result.error.message).toContain('typo@@example');
  });

  test('rejects more than the maximum number of addresses', () => {
    const tooMany = Array.from({ length: MAX_REPORTING_CC_ADDRESSES + 1 }, (unused, index) => `cc${index}@example.com`).join(',');
    expect(normaliseReportingCcForStorage(tooMany).error).toBeDefined();
  });

  test('rejects a non-string', () => {
    expect(normaliseReportingCcForStorage(['a@example.com']).error).toBeDefined();
  });
});

describe('resolveReportDelivery', () => {
  const baseAccount = { username: 'owner@example.com', reporting_email: null, reporting_cc: null, reporting_weekday: 'MON', paused: 0, blocked: 0, last_summary_sent_at: null };

  test('falls back to the username when no reporting email is set', () => {
    expect(resolveReportDelivery(baseAccount)).toMatchObject({ to: 'owner@example.com', to_source: 'username', reporting_email_rejected: false, cc: [] });
  });

  test('uses a valid reporting email', () => {
    expect(resolveReportDelivery({ ...baseAccount, reporting_email: 'reports@example.com' })).toMatchObject({ to: 'reports@example.com', to_source: 'reporting_email' });
  });

  test('flags an unusable reporting email instead of falling back silently', () => {
    expect(resolveReportDelivery({ ...baseAccount, reporting_email: 'broken' })).toMatchObject({ to: 'owner@example.com', to_source: 'username', reporting_email_rejected: true });
  });

  test('copies in the CC list, never the main recipient twice, and reports rejected entries', () => {
    const delivery = resolveReportDelivery({ ...baseAccount, reporting_cc: 'agency@example.net, OWNER@example.com, bad-entry' });
    expect(delivery.cc).toEqual(['agency@example.net']);
    expect(delivery.cc_rejected).toEqual(['bad-entry']);
  });

  test('reports the schedule and status flags', () => {
    expect(resolveReportDelivery({ ...baseAccount, paused: 1 })).toMatchObject({ weekday: 'MON', paused: true, blocked: false });
  });
});
