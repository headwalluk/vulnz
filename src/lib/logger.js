/**
 * Console logging gated on LOG_LEVEL (debug < info < warn < error; default info).
 */

const { parseEnum } = require('./env');

const LEVELS = ['debug', 'info', 'warn', 'error'];
const DEFAULT_LEVEL = 'info';

/** Whether messages at `level` are printed under the configured LOG_LEVEL. */
function isLevelEnabled(level) {
  const configuredLevel = parseEnum('LOG_LEVEL', LEVELS, DEFAULT_LEVEL);
  return LEVELS.indexOf(level) >= LEVELS.indexOf(configuredLevel);
}

/** Per-request and per-tick detail, for diagnosing a problem. */
function debug(...messageParts) {
  if (isLevelEnabled('debug')) {
    console.log(...messageParts);
  }
}

/** Outcomes of routine work and startup progress. */
function info(...messageParts) {
  if (isLevelEnabled('info')) {
    console.log(...messageParts);
  }
}

/** Something an operator should see even with a quiet log. */
function warn(...messageParts) {
  if (isLevelEnabled('warn')) {
    console.warn(...messageParts);
  }
}

/** A failure. Always printed. */
function error(...messageParts) {
  console.error(...messageParts);
}

module.exports = { isLevelEnabled, debug, info, warn, error };
