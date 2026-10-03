const db = require('../db');
const { isUrl } = require('../lib/sanitizer');
const { ERROR_CODES } = require('../lib/apiErrors');
const { MAX_VULNERABILITY_URL_LENGTH } = require('./vulnerability');
const logger = require('../lib/logger');

/**
 * Mirrors the cvss_ratings lookup, highest first, with each band's lowest CVSS v3 score.
 * Kept here so a rating can be validated without a query per item; the FK is the authority.
 */
const CVSS_BANDS = [
  { slug: 'critical', rank: 4, minScore: 9.0 },
  { slug: 'high', rank: 3, minScore: 7.0 },
  { slug: 'medium', rank: 2, minScore: 4.0 },
  { slug: 'low', rank: 1, minScore: 0.1 },
  { slug: 'none', rank: 0, minScore: 0.0 },
];
const RATING_NONE = 'none';
const RATING_RANK = Object.fromEntries(CVSS_BANDS.map((band) => [band.slug, band.rank]));
const MAX_CVSS_SCORE = 10;
const MAX_EXTERNAL_ID_LENGTH = 255;
const MAX_TITLE_LENGTH = 512;
const MAX_CWE_NAME_LENGTH = 255;
const MAX_VECTOR_LENGTH = 255;
const MAX_ALIASES = 10;
const CVE_PATTERN = /^CVE-\d{4}-\d{4,}$/i;
const CVSS_VECTOR_PREFIX = 'CVSS:';
const ADVISORY_FIELDS = ['source', 'external_id', 'title', 'cve', 'cwe', 'cvss', 'informational', 'published_at', 'updated_at', 'aliases'];
const CVSS_FIELDS = ['score', 'rating', 'vector'];
const CWE_FIELDS = ['id', 'name'];

/** The CVSS v3 band a score falls in. */
const ratingForScore = (score) => CVSS_BANDS.find((band) => score >= band.minScore).slug;

/** A per-field validation failure, with the field path inside the item. */
const advisoryError = (code, field, message) => ({ error: { code, field: `advisory.${field}`, message } });

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SPACED_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Parse an optional timestamp: ISO 8601, or Wordfence's 'YYYY-MM-DD HH:MM:SS' / 'YYYY-MM-DD', read as UTC.
 * @returns {Date|null|undefined} undefined when absent, null when unparseable
 */
const parseOptionalDate = (value) => {
  let parsed;
  if (value !== undefined && value !== null) {
    let text = typeof value === 'string' ? value.trim() : '';
    if (DATE_ONLY_PATTERN.test(text)) {
      text = `${text}T00:00:00Z`;
    } else if (SPACED_DATETIME_PATTERN.test(text)) {
      text = `${text.replace(' ', 'T')}Z`;
    }
    const date = text ? new Date(text) : null;
    parsed = date && !Number.isNaN(date.getTime()) ? date : null;
  }
  return parsed;
};

/**
 * Validate and normalise the `advisory` object of a bulk vulnerability item.
 * The source slug is checked against the lookup by the caller, which holds the list.
 *
 * @returns {{advisory: object}|{error: {code: string, field: string, message: string}}}
 */
function normaliseAdvisory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: { code: ERROR_CODES.FIELD_INVALID, field: 'advisory', message: 'advisory must be an object.' } };
  }

  const unknownField = Object.keys(input).find((field) => !ADVISORY_FIELDS.includes(field));
  const { cvss, cwe } = input;
  const publishedAt = parseOptionalDate(input.published_at);
  const updatedAt = parseOptionalDate(input.updated_at);

  let result;
  if (unknownField) {
    result = advisoryError(ERROR_CODES.UNKNOWN_FIELD, unknownField, `Unknown field ${unknownField}; allowed: ${ADVISORY_FIELDS.join(', ')}.`);
  } else if (typeof input.source !== 'string' || input.source.trim() === '') {
    result = advisoryError(ERROR_CODES.FIELD_REQUIRED, 'source', 'advisory.source is required.');
  } else if (typeof input.external_id !== 'string' || input.external_id.trim() === '' || input.external_id.length > MAX_EXTERNAL_ID_LENGTH) {
    result = advisoryError(ERROR_CODES.FIELD_REQUIRED, 'external_id', `advisory.external_id is required, at most ${MAX_EXTERNAL_ID_LENGTH} characters.`);
  } else if (input.title !== undefined && input.title !== null && (typeof input.title !== 'string' || input.title.length > MAX_TITLE_LENGTH)) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'title', `advisory.title must be a string of at most ${MAX_TITLE_LENGTH} characters.`);
  } else if (input.cve !== undefined && input.cve !== null && !(typeof input.cve === 'string' && CVE_PATTERN.test(input.cve.trim()))) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cve', 'advisory.cve must look like CVE-2024-12345.');
  } else if (cwe !== undefined && cwe !== null && (typeof cwe !== 'object' || Array.isArray(cwe))) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cwe', 'advisory.cwe must be an object with id and name.');
  } else if (cwe && Object.keys(cwe).some((field) => !CWE_FIELDS.includes(field))) {
    result = advisoryError(ERROR_CODES.UNKNOWN_FIELD, 'cwe', `advisory.cwe allows only: ${CWE_FIELDS.join(', ')}.`);
  } else if (cwe && cwe.id !== undefined && cwe.id !== null && !(Number.isInteger(cwe.id) && cwe.id > 0)) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cwe.id', 'advisory.cwe.id must be a positive integer.');
  } else if (cwe && cwe.name !== undefined && cwe.name !== null && (typeof cwe.name !== 'string' || cwe.name.length > MAX_CWE_NAME_LENGTH)) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cwe.name', `advisory.cwe.name must be a string of at most ${MAX_CWE_NAME_LENGTH} characters.`);
  } else if (cvss !== undefined && cvss !== null && (typeof cvss !== 'object' || Array.isArray(cvss))) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cvss', 'advisory.cvss must be an object with score, rating and vector.');
  } else if (cvss && Object.keys(cvss).some((field) => !CVSS_FIELDS.includes(field))) {
    result = advisoryError(ERROR_CODES.UNKNOWN_FIELD, 'cvss', `advisory.cvss allows only: ${CVSS_FIELDS.join(', ')}.`);
  } else if (cvss && cvss.score !== undefined && cvss.score !== null && !(typeof cvss.score === 'number' && cvss.score >= 0 && cvss.score <= MAX_CVSS_SCORE)) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cvss.score', `advisory.cvss.score must be a number from 0 to ${MAX_CVSS_SCORE}.`);
  } else if (cvss && cvss.rating !== undefined && cvss.rating !== null && !(typeof cvss.rating === 'string' && RATING_RANK[cvss.rating.toLowerCase()] !== undefined)) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cvss.rating', `advisory.cvss.rating must be one of: ${CVSS_BANDS.map((band) => band.slug).join(', ')}.`);
  } else if (
    cvss &&
    cvss.vector !== undefined &&
    cvss.vector !== null &&
    !(typeof cvss.vector === 'string' && cvss.vector.startsWith(CVSS_VECTOR_PREFIX) && cvss.vector.length <= MAX_VECTOR_LENGTH)
  ) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'cvss.vector', `advisory.cvss.vector must be a CVSS vector string starting ${CVSS_VECTOR_PREFIX}.`);
  } else if (input.informational !== undefined && input.informational !== null && typeof input.informational !== 'boolean') {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'informational', 'advisory.informational must be a boolean.');
  } else if (publishedAt === null) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'published_at', 'advisory.published_at must be an ISO 8601 or YYYY-MM-DD HH:MM:SS timestamp.');
  } else if (updatedAt === null) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'updated_at', 'advisory.updated_at must be an ISO 8601 or YYYY-MM-DD HH:MM:SS timestamp.');
  } else if (
    input.aliases !== undefined &&
    input.aliases !== null &&
    !(
      Array.isArray(input.aliases) &&
      input.aliases.length <= MAX_ALIASES &&
      input.aliases.every((alias) => typeof alias === 'string' && isUrl(alias) && alias.length <= MAX_VULNERABILITY_URL_LENGTH)
    )
  ) {
    result = advisoryError(ERROR_CODES.FIELD_INVALID, 'aliases', `advisory.aliases must be an array of at most ${MAX_ALIASES} URLs.`);
  } else {
    result = {
      advisory: {
        source: input.source.trim().toLowerCase(),
        externalId: input.external_id.trim(),
        title: input.title || null,
        cve: input.cve ? input.cve.trim().toUpperCase() : null,
        cweId: cwe && Number.isInteger(cwe.id) ? cwe.id : null,
        cweName: cwe && cwe.name ? cwe.name : null,
        cvssScore: cvss && typeof cvss.score === 'number' ? Math.round(cvss.score * 10) / 10 : null,
        cvssRating: cvss && typeof cvss.rating === 'string' ? cvss.rating.toLowerCase() : null,
        cvssVector: cvss && cvss.vector ? cvss.vector : null,
        isInformational: input.informational === true,
        publishedAt: publishedAt || null,
        sourceUpdatedAt: updatedAt || null,
        aliases: Array.isArray(input.aliases) ? input.aliases : [],
      },
    };
  }
  return result;
}

/** Slugs in the advisory_sources lookup. */
async function findSourceSlugs() {
  const rows = await db.query('SELECT slug FROM advisory_sources ORDER BY slug');
  return rows.map((row) => row.slug);
}

/**
 * Insert or update an advisory by (source, external_id), and attach the given URLs to it.
 * @param {object} advisory  From normaliseAdvisory().
 * @param {string[]} urls  The item's vulnerability URLs; aliases are added to these.
 * @returns {Promise<{advisoryId: number, created: boolean}>}
 */
async function upsert(advisory, urls) {
  if (advisory.cvssScore !== null && advisory.cvssRating !== null && ratingForScore(advisory.cvssScore) !== advisory.cvssRating) {
    // Stored as the source gave them; the source is the authority on its own rating
    logger.warn(
      `Advisory ${advisory.source}/${advisory.externalId}: score ${advisory.cvssScore} falls in ${ratingForScore(advisory.cvssScore)}, source rates it ${advisory.cvssRating}`
    );
  }

  const columns = [
    advisory.title,
    advisory.cve,
    advisory.cweId,
    advisory.cweName,
    advisory.cvssScore,
    advisory.cvssRating,
    advisory.cvssVector,
    advisory.isInformational ? 1 : 0,
    advisory.publishedAt,
    advisory.sourceUpdatedAt,
  ];
  const [existing] = await db.query('SELECT id FROM advisories WHERE source_slug = ? AND external_id = ?', [advisory.source, advisory.externalId]);
  let advisoryId;
  let created = false;
  if (existing) {
    advisoryId = parseInt(existing.id, 10);
    await db.query(
      'UPDATE advisories SET title = ?, cve = ?, cwe_id = ?, cwe_name = ?, cvss_score = ?, cvss_rating_slug = ?, cvss_vector = ?, is_informational = ?, published_at = ?, source_updated_at = ? WHERE id = ?',
      [...columns, advisoryId]
    );
  } else {
    const result = await db.query(
      'INSERT INTO advisories (source_slug, external_id, title, cve, cwe_id, cwe_name, cvss_score, cvss_rating_slug, cvss_vector, is_informational, published_at, source_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [advisory.source, advisory.externalId, ...columns]
    );
    advisoryId = parseInt(result.insertId, 10);
    created = true;
  }

  const uniqueUrls = [...new Set([...urls, ...advisory.aliases])];
  if (uniqueUrls.length > 0) {
    const placeholders = uniqueUrls.map(() => '(?, ?)').join(', ');
    await db.query(
      `INSERT IGNORE INTO advisory_urls (advisory_id, url) VALUES ${placeholders}`,
      uniqueUrls.flatMap((url) => [advisoryId, url])
    );
  }
  return { advisoryId, created };
}

/** The rating reads report: informational advisories rate 'none', whatever the source scored them. */
const effectiveRating = (row) => (row.is_informational ? RATING_NONE : row.cvss_rating_slug || null);

/**
 * Summarise vulnerability rows joined to their advisories, grouped by a key.
 * Each row: { key, url, advisory_id, source_slug, external_id, title, cve, cvss_score, cvss_rating_slug, is_informational }
 * with null advisory columns for a URL no advisory claims.
 *
 * @returns {Map<*, {advisories: object[], max_cvss_score: number|null, max_cvss_rating: string|null, unrated_vulnerabilities: number}>}
 */
function summariseByKey(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.key)) {
      groups.set(row.key, { advisoriesById: new Map(), ratedUrls: new Set(), urls: new Set() });
    }
    const group = groups.get(row.key);
    group.urls.add(row.url);
    if (row.advisory_id !== null && row.advisory_id !== undefined) {
      const rating = effectiveRating(row);
      if (rating) {
        group.ratedUrls.add(row.url);
      }
      if (!group.advisoriesById.has(row.advisory_id)) {
        group.advisoriesById.set(row.advisory_id, {
          source: row.source_slug,
          external_id: row.external_id,
          title: row.title || null,
          cve: row.cve || null,
          cvss_score: row.cvss_score === null || row.cvss_score === undefined ? null : Number(row.cvss_score),
          cvss_rating: rating,
          is_informational: Boolean(row.is_informational),
          url: row.url,
        });
      }
    }
  }

  const summaries = new Map();
  for (const [key, group] of groups) {
    const advisories = [...group.advisoriesById.values()].sort(
      (left, right) => (RATING_RANK[right.cvss_rating] ?? -1) - (RATING_RANK[left.cvss_rating] ?? -1) || (right.cvss_score ?? -1) - (left.cvss_score ?? -1)
    );
    const rated = advisories.filter((advisory) => advisory.cvss_rating !== null);
    summaries.set(key, {
      advisories,
      max_cvss_score: rated.some((advisory) => advisory.cvss_score !== null)
        ? Math.max(...rated.filter((advisory) => advisory.cvss_score !== null).map((advisory) => advisory.cvss_score))
        : null,
      max_cvss_rating: rated.length > 0 ? rated[0].cvss_rating : null,
      // Vulnerabilities no rated advisory accounts for; a max rating is a lower bound while this is above 0
      unrated_vulnerabilities: group.urls.size - group.ratedUrls.size,
    });
  }
  return summaries;
}

const ADVISORY_COLUMNS = 'a.id AS advisory_id, a.source_slug, a.external_id, a.title, a.cve, a.cvss_score, a.cvss_rating_slug, a.is_informational';

/** Severity for each release, keyed by release id. Releases without vulnerabilities are absent. */
async function severityForReleases(releaseIds) {
  let rows = [];
  if (releaseIds.length > 0) {
    rows = await db.query(
      `SELECT v.release_id AS \`key\`, v.url, ${ADVISORY_COLUMNS}
       FROM vulnerabilities v
       LEFT JOIN advisory_urls au ON au.url_hash = v.url_hash
       LEFT JOIN advisories a ON a.id = au.advisory_id
       WHERE v.release_id IN (?)`,
      [releaseIds]
    );
  }
  return summariseByKey(rows.map((row) => ({ ...row, key: parseInt(row.key, 10) })));
}

/** Severity for a set of vulnerability URLs not stored against a release (an unrecorded version judged by ranges). */
async function severityForUrls(urls) {
  let rows = [];
  if (urls.length > 0) {
    const linked = await db.query(`SELECT au.url, ${ADVISORY_COLUMNS} FROM advisory_urls au JOIN advisories a ON a.id = au.advisory_id WHERE au.url IN (?)`, [urls]);
    const linkedUrls = new Set(linked.map((row) => row.url));
    rows = [...linked, ...urls.filter((url) => !linkedUrls.has(url)).map((url) => ({ url, advisory_id: null }))];
  }
  return summariseByKey(rows.map((row) => ({ ...row, key: 'urls' }))).get('urls') || emptySeverity();
}

/** The severity of something with no vulnerabilities. */
const emptySeverity = () => ({ advisories: [], max_cvss_score: null, max_cvss_rating: null, unrated_vulnerabilities: 0 });

module.exports = {
  normaliseAdvisory,
  findSourceSlugs,
  upsert,
  severityForReleases,
  severityForUrls,
  emptySeverity,
  ratingForScore,
  CVSS_BANDS,
  RATING_RANK,
  RATING_NONE,
};
