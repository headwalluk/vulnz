/**
 * Strict parsers for query-string parameters.
 *
 * Each returns null when the parameter is absent and undefined when it is
 * present but invalid, so a route can tell "not asked" from "asked wrongly"
 * and answer the second with a 400 rather than a silently wider result set.
 */

const TRUE_VALUES = ['true', '1'];
const FALSE_VALUES = ['false', '0'];

/**
 * A query parameter is a positive integer, or it is not supplied.
 * Rejects `1.5`, `abc`, `0`, `-3`, and `10x` alike.
 * @returns {number|null|undefined} the value, null when absent, undefined when invalid
 */
const positiveInteger = (raw) => {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (!/^\d+$/.test(String(raw).trim())) {
    return undefined;
  }
  const value = parseInt(String(raw).trim(), 10);
  return value >= 1 ? value : undefined;
};

/**
 * A query parameter is `true`/`1` or `false`/`0`, or it is not supplied.
 * @returns {boolean|null|undefined} the value, null when absent, undefined when invalid
 */
const booleanFlag = (raw) => {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const normalised = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.includes(normalised)) {
    return true;
  }
  if (FALSE_VALUES.includes(normalised)) {
    return false;
  }
  return undefined;
};

module.exports = { positiveInteger, booleanFlag };
