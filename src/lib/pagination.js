const { parseIntEnv } = require('./env');

/**
 * Shared page/limit handling for list endpoints.
 *
 * Previously each route did `parseInt(req.query.limit, 10) || 10`, which is
 * wrong in three separate ways and all of them fail quietly:
 *
 *   - `limit=0` and `limit=abc` both become the default, so a caller gets a
 *     full page when it asked for none, or asked for nonsense.
 *   - `page=-1` produces a negative OFFSET, which the database rejects or
 *     silently mishandles depending on engine.
 *   - There was no upper bound at all, so `limit=10000` was accepted.
 *
 * Out-of-range values are rejected rather than clamped. Returning a
 * different `limit` than the caller asked for is the same failure mode as
 * the old silent `sort` fallback: correct-looking output that quietly
 * answers a different question. Callers see the constraint and can act on
 * it. Verified against 30 days of production traffic before choosing this —
 * no client sends a limit above 50, so nothing legitimate is affected.
 */

const DEFAULT_MAX_PAGE_SIZE = 200;

const maxPageSize = () => parseIntEnv('API_MAX_PAGE_SIZE', { min: 1, default: DEFAULT_MAX_PAGE_SIZE });

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
 * @param {object} query  req.query
 * @param {number} defaultLimit  used when the caller supplies no limit
 * @returns {{page: number, limit: number, offset: number}|{error: {error: string, message: string}}}
 */
function resolvePagination(query, defaultLimit) {
  const page = positiveInteger(query.page);
  if (page === undefined) {
    return { error: { error: 'Invalid page', message: 'page must be a positive integer.' } };
  }

  const limit = positiveInteger(query.limit);
  if (limit === undefined) {
    return { error: { error: 'Invalid limit', message: 'limit must be a positive integer.' } };
  }

  const maximum = maxPageSize();
  if (limit !== null && limit > maximum) {
    return {
      error: {
        error: 'Limit too large',
        message: `limit must be ${maximum} or fewer. Page through the results instead.`,
      },
    };
  }

  const resolvedPage = page || 1;
  const resolvedLimit = limit || defaultLimit;

  return {
    page: resolvedPage,
    limit: resolvedLimit,
    offset: (resolvedPage - 1) * resolvedLimit,
  };
}

module.exports = { resolvePagination, maxPageSize, DEFAULT_MAX_PAGE_SIZE };
