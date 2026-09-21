/**
 * Leveled logging
 *
 * LOG_LEVEL=warn must silence routine output; debug < info < warn < error.
 */

const logger = require('../../src/lib/logger');

describe('logger', () => {
  let savedLevel;
  let logSpy;
  let warnSpy;
  let errorSpy;

  beforeEach(() => {
    savedLevel = process.env.LOG_LEVEL;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = savedLevel;
    }
    jest.restoreAllMocks();
  });

  /** Log one message at every level, returning which ones were printed. */
  function printedLevels() {
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    return [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call[0].split(' ')[0]);
  }

  test.each([
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['info', ['info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['error', ['error']],
  ])('LOG_LEVEL=%s prints %p', (level, expected) => {
    process.env.LOG_LEVEL = level;

    expect(printedLevels()).toEqual(expected);
  });

  test('an unset or unrecognised LOG_LEVEL behaves as info', () => {
    process.env.LOG_LEVEL = 'chatty';

    expect(printedLevels()).toEqual(['info', 'warn', 'error']);
  });
});
