/**
 * Date helpers shared across the read paths.
 *
 * Kept out of `src/lib/wporg.js` deliberately: formatting a stored date is
 * not a wordpress.org concern, and routes that needed it were having to pull
 * in the whole sync module — and its database handle — to render one column.
 */

/**
 * Render a DATE column back as `YYYY-MM-DD`.
 *
 * mysql2 hands a DATE column back as a JS Date, which stringifies to "Thu Feb
 * 05 2026 00:00:00 GMT+0000 (Coordinated Universal Time)" in CLI output and
 * to a full ISO timestamp in JSON — both of which assert a time of day and a
 * timezone that a date-only column does not have. SQLite hands back the plain
 * string it was given, so both shapes have to be accepted.
 *
 * @param {Date|string|null|undefined} value
 * @returns {string|null} `YYYY-MM-DD`, or null if there is no usable date
 */
function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const candidate = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

module.exports = { formatDateOnly };
