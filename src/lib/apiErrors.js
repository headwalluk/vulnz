/**
 * Machine-readable error codes for bulk endpoint responses. Part of the API contract:
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
