/**
 * Version parsing and comparison for WordPress and npm version strings.
 *
 * Rules: docs/version-matching.md
 */

const { stripAll } = require('./sanitizer');
const { ERROR_CODES } = require('./apiErrors');

/** Longest version string stored; matches releases.version and the range bound columns. */
const MAX_VERSION_LENGTH = 255;
const STRICT_VERSION_PATTERN = /^[0-9A-Za-z.\-+_~]+$/;

const LEADING_V_PATTERN = /^v/i;
const BUILD_METADATA_PATTERN = /\+.*$/;
const NUMERIC_CORE_PATTERN = /^(\d+(?:\.\d+)*)(.*)$/;
const STAGE_SUFFIX_PATTERN = /^[-._~]?([a-z]+)[-._]?(\d*)$/i;
const LEADING_ZEROS_PATTERN = /^0+(?=\d)/;

const STAGE_RANK_FINAL = 0;

/**
 * Stage ranks, ordered as PHP version_compare() orders them. The single letters PHP also
 * accepts (a, b, p) are deliberately absent: plugin authors use "1.0b" for a later build
 * as often as for a beta, so they are unrecognised suffixes rather than a guess.
 */
const STAGE_RANKS = new Map([
  ['dev', -4],
  ['alpha', -3],
  ['beta', -2],
  ['rc', -1],
  ['patch', 1],
  ['pl', 1],
]);

/**
 * Clean a reported version for storage without rewriting it: strip tags, trim, cap length.
 *
 * @param {*} rawVersion
 * @returns {string|null} null when there is nothing usable to store
 */
function normaliseReportedVersion(rawVersion) {
  let version = null;
  if (typeof rawVersion === 'string') {
    const cleaned = stripAll(rawVersion).trim();
    if (cleaned !== '' && cleaned.length <= MAX_VERSION_LENGTH) {
      version = cleaned;
    }
  }
  return version;
}

/**
 * Strict check for a version an advisory names: a range bound or an exact vulnerable version.
 *
 * @param {*} version
 * @param {string} fieldName used in the error message
 * @returns {{code: string, message: string}|null} null when valid
 */
function validateVersion(version, fieldName) {
  let error = null;
  if (typeof version !== 'string' || version.length === 0 || version.length > MAX_VERSION_LENGTH) {
    error = { code: ERROR_CODES.FIELD_INVALID, message: `${fieldName} must be a version string of 1-${MAX_VERSION_LENGTH} characters.` };
  } else if (!STRICT_VERSION_PATTERN.test(version) || !parseVersion(version)) {
    error = { code: ERROR_CODES.UNRECOGNISED_VERSION, message: `${fieldName} is not a recognisable version: ${version}` };
  }
  return error;
}

/** Compare two unsigned decimal digit strings of any length. */
function compareDigitStrings(left, right) {
  const leftDigits = left.replace(LEADING_ZEROS_PATTERN, '');
  const rightDigits = right.replace(LEADING_ZEROS_PATTERN, '');
  let result = 0;
  if (leftDigits.length !== rightDigits.length) {
    result = leftDigits.length > rightDigits.length ? 1 : -1;
  } else if (leftDigits !== rightDigits) {
    result = leftDigits > rightDigits ? 1 : -1;
  }
  return result;
}

/**
 * Parse a version string into its numeric core and release stage.
 *
 * @param {string} version
 * @returns {{core: string[], stageRank: number|null, stageNumber: string, suffix: string}|null}
 *   null when there is no numeric core; stageRank is null for an unrecognised suffix
 */
function parseVersion(version) {
  let parsed = null;
  if (typeof version === 'string') {
    const cleaned = version.trim().replace(LEADING_V_PATTERN, '').replace(BUILD_METADATA_PATTERN, '');
    const coreMatch = cleaned.match(NUMERIC_CORE_PATTERN);
    if (coreMatch) {
      const suffix = coreMatch[2];
      let stageRank = STAGE_RANK_FINAL;
      let stageNumber = '0';
      if (suffix !== '') {
        const stageMatch = suffix.match(STAGE_SUFFIX_PATTERN);
        const rank = stageMatch ? STAGE_RANKS.get(stageMatch[1].toLowerCase()) : undefined;
        stageRank = rank === undefined ? null : rank;
        stageNumber = stageMatch && stageMatch[2] !== '' ? stageMatch[2] : '0';
      }
      parsed = {
        core: coreMatch[1].split('.'),
        stageRank,
        stageNumber,
        suffix: suffix.toLowerCase(),
      };
    }
  }
  return parsed;
}

/** Compare the numeric cores of two parsed versions, padding missing segments with 0. */
function compareCores(leftParsed, rightParsed) {
  let result = 0;
  const segmentCount = Math.max(leftParsed.core.length, rightParsed.core.length);
  for (let index = 0; index < segmentCount; index++) {
    result = compareDigitStrings(leftParsed.core[index] || '0', rightParsed.core[index] || '0');
    if (result !== 0) {
      break;
    }
  }
  return result;
}

/** Compare the stages of two parsed versions whose stage ranks are both known. */
function compareKnownStages(leftParsed, rightParsed) {
  let result = compareDigitStrings(leftParsed.stageNumber, rightParsed.stageNumber);
  if (leftParsed.stageRank !== rightParsed.stageRank) {
    result = leftParsed.stageRank > rightParsed.stageRank ? 1 : -1;
  }
  return result;
}

/**
 * Compare two versions.
 *
 * @param {string} left
 * @param {string} right
 * @returns {-1|0|1|null} null when the order cannot be decided
 */
function compareVersions(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  let result = null;

  if (leftParsed && rightParsed) {
    result = compareCores(leftParsed, rightParsed);
    if (result === 0) {
      if (leftParsed.stageRank === null || rightParsed.stageRank === null) {
        // An unrecognised suffix only orders against an identical suffix.
        result = leftParsed.suffix === rightParsed.suffix ? 0 : null;
      } else {
        result = compareKnownStages(leftParsed, rightParsed);
      }
    }
  }

  return result;
}

/**
 * Total ordering for sorting. Agrees with compareVersions() wherever that decides;
 * otherwise unparseable versions sort first and unknown suffixes sort just after
 * the final release of their core, by suffix text.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function versionSortCompare(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  let result = 0;

  if (!leftParsed || !rightParsed) {
    if (leftParsed || rightParsed) {
      result = leftParsed ? 1 : -1;
    } else {
      result = String(left).localeCompare(String(right));
    }
  } else {
    result = compareCores(leftParsed, rightParsed);
    const leftUnknown = leftParsed.stageRank === null;
    const rightUnknown = rightParsed.stageRank === null;
    if (result !== 0) {
      // Decided by the numeric core.
    } else if (leftUnknown && rightUnknown) {
      result = leftParsed.suffix.localeCompare(rightParsed.suffix);
    } else if (leftUnknown || rightUnknown) {
      const knownParsed = leftUnknown ? rightParsed : leftParsed;
      const unknownSortsAfter = knownParsed.stageRank <= STAGE_RANK_FINAL;
      result = unknownSortsAfter === leftUnknown ? 1 : -1;
    } else {
      result = compareKnownStages(leftParsed, rightParsed);
    }
  }

  return result;
}

/**
 * Whether a version is one side of a single bound.
 *
 * @returns {boolean|null} null when the comparison cannot be decided
 */
function isWithinBound(version, boundVersion, isInclusive, isLowerBound) {
  let result = true;
  if (boundVersion !== null) {
    const comparison = compareVersions(version, boundVersion);
    if (comparison === null) {
      result = null;
    } else if (comparison === 0) {
      result = isInclusive;
    } else {
      result = isLowerBound ? comparison > 0 : comparison < 0;
    }
  }
  return result;
}

/**
 * Whether a version falls inside an affected range. Null bounds are unbounded.
 *
 * @param {string} version
 * @param {{fromVersion: string|null, fromInclusive: boolean, toVersion: string|null, toInclusive: boolean}} range
 * @returns {boolean|null} null when the version cannot be placed against the range
 */
function isVersionInRange(version, range) {
  const withinLower = isWithinBound(version, range.fromVersion, range.fromInclusive, true);
  const withinUpper = isWithinBound(version, range.toVersion, range.toInclusive, false);
  let result = null;
  if (withinLower === false || withinUpper === false) {
    result = false;
  } else if (withinLower === true && withinUpper === true) {
    result = true;
  }
  return result;
}

/**
 * The final-release version a recognised pre-release (dev, alpha, beta, rc) belongs to.
 *
 * @param {string} version
 * @returns {string|null} e.g. "2.0.0" for "2.0.0-dev"; null for anything that is not a recognised pre-release
 */
function preReleaseFinalVersion(version) {
  const parsed = parseVersion(version);
  let finalVersion = null;
  if (parsed && parsed.stageRank !== null && parsed.stageRank < STAGE_RANK_FINAL) {
    finalVersion = parsed.core.join('.');
  }
  return finalVersion;
}

/**
 * Whether a release is affected by a range. A pre-release is also affected when its final
 * release is; a final release never inherits from its pre-releases.
 *
 * @param {string} version
 * @param {object} range as for isVersionInRange()
 * @returns {boolean|null} null when neither check can decide and neither says affected
 */
function isReleaseAffected(version, range) {
  const direct = isVersionInRange(version, range);
  const finalVersion = direct === true ? null : preReleaseFinalVersion(version);
  const inherited = finalVersion === null ? false : isVersionInRange(finalVersion, range);
  let result = false;
  if (direct === true || inherited === true) {
    result = true;
  } else if (direct === null || inherited === null) {
    result = null;
  }
  return result;
}

module.exports = {
  MAX_VERSION_LENGTH,
  normaliseReportedVersion,
  validateVersion,
  parseVersion,
  compareVersions,
  versionSortCompare,
  isVersionInRange,
  preReleaseFinalVersion,
  isReleaseAffected,
};
