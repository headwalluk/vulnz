/**
 * Machine-readable error codes for bulk and patch endpoint responses. Part of the API contract:
 * clients branch on `code`, never on `message`, which may be reworded.
 */

const ERROR_CODES = Object.freeze({
  ITEMS_INVALID: 'ITEMS_INVALID',
  TOO_MANY_ITEMS: 'TOO_MANY_ITEMS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ITEM_NOT_OBJECT: 'ITEM_NOT_OBJECT',
  FIELD_REQUIRED: 'FIELD_REQUIRED',
  FIELD_INVALID: 'FIELD_INVALID',
  CONFLICTING_FIELDS: 'CONFLICTING_FIELDS',
  UNKNOWN_COMPONENT_TYPE: 'UNKNOWN_COMPONENT_TYPE',
  UNRECOGNISED_VERSION: 'UNRECOGNISED_VERSION',
  EMPTY_RANGE: 'EMPTY_RANGE',
  INVALID_URL: 'INVALID_URL',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  UNKNOWN_ADVISORY_SOURCE: 'UNKNOWN_ADVISORY_SOURCE',
  COMPONENT_NOT_INSTALLED: 'COMPONENT_NOT_INSTALLED',
  VERSION_NOT_INSTALLED: 'VERSION_NOT_INSTALLED',
  PATCH_NOT_FOUND: 'PATCH_NOT_FOUND',
  UNKNOWN_FEED_TYPE: 'UNKNOWN_FEED_TYPE',
  FEED_NOT_CONFIGURED: 'FEED_NOT_CONFIGURED',
  FEED_DISABLED: 'FEED_DISABLED',
  FEED_TYPE_MISMATCH: 'FEED_TYPE_MISMATCH',
});

/** A per-item error entry; `field` names the offending field, or is null for the whole item. */
function itemError(index, code, field, message) {
  return { index, code, field, message };
}

/** A request-level error body. */
function requestError(code, message) {
  return { error: message, code };
}

module.exports = { ERROR_CODES, itemError, requestError };
