/**
 * Release feeds (M31): validating feed settings, and applying one result posted by the importer.
 */

const db = require('../db');
const ReleaseFeed = require('../models/releaseFeed');
const Release = require('../models/release');
const { compareVersions } = require('./versionCompare');
const { sanitizeChangelogHtml } = require('./htmlSanitizer');

const FEED_URL_SCHEME = 'https:';
// A params key naming a credential is refused unless it names an env var instead (license_env)
const SECRET_PARAM_PATTERN = /(licen[cs]e|key|token|secret|password)/i;
const ENV_REFERENCE_SUFFIX = '_env';
// releases.changelog is MEDIUMTEXT; a vendor's changelog for one release is far smaller than this
const CHANGELOG_MAX_LENGTH = 65536;

const OUTCOMES = Object.freeze({
  ADVANCED: 'advanced',
  UNCHANGED: 'unchanged',
  OLDER: 'older',
  UNDECIDABLE: 'undecidable',
  FAILURE_RECORDED: 'failure_recorded',
});

/**
 * Check a feed's type, URL and params before saving.
 * @param {{feedType: string, feedUrl: string, params: *}} settings params as a JSON string, an object, or null
 * @returns {Promise<{problems: string[], params: object|null}>} params parsed; problems empty when valid
 */
async function validateFeedSettings({ feedType, feedUrl, params }) {
  const problems = [];
  let parsedParams = null;

  if (typeof feedType !== 'string' || feedType === '') {
    problems.push('A feed type is required.');
  } else if (!(await ReleaseFeed.typeExists(feedType))) {
    problems.push(`Unknown feed type "${feedType}". List them with component:feed:type:list.`);
  }

  if (typeof feedUrl !== 'string' || feedUrl === '') {
    problems.push('A feed URL is required.');
  } else if (feedUrl.length > ReleaseFeed.FEED_URL_MAX_LENGTH) {
    problems.push(`The feed URL must be ${ReleaseFeed.FEED_URL_MAX_LENGTH} characters or fewer.`);
  } else if (!URL.canParse(feedUrl) || new URL(feedUrl).protocol !== FEED_URL_SCHEME) {
    problems.push(`The feed URL must be a valid https:// URL: ${feedUrl}`);
  }

  if (typeof params === 'string') {
    try {
      parsedParams = JSON.parse(params);
    } catch (err) {
      problems.push(`params is not valid JSON: ${err.message}`);
      parsedParams = undefined;
    }
  } else if (params !== null && params !== undefined) {
    parsedParams = params;
  }

  if (parsedParams !== undefined && parsedParams !== null) {
    if (typeof parsedParams !== 'object' || Array.isArray(parsedParams)) {
      problems.push('params must be a JSON object.');
    } else {
      const secretKeys = Object.keys(parsedParams).filter((key) => SECRET_PARAM_PATTERN.test(key) && !key.toLowerCase().endsWith(ENV_REFERENCE_SUFFIX));
      if (secretKeys.length > 0) {
        problems.push(
          `params must not hold credentials (${secretKeys.join(', ')}). Put the secret in the importer's .env and name the variable, e.g. {"license_env": "VENDOR_LICENSE_KEY"}.`
        );
      }
    }
  }

  return { problems, params: parsedParams === undefined ? null : parsedParams };
}

/** Store a changelog and release date on a release, each only where it has none yet. */
async function fillReleaseDetails(releaseId, { releaseDate, changelog }) {
  if (releaseDate) {
    await db.query('UPDATE releases SET release_date = ? WHERE id = ? AND release_date IS NULL', [releaseDate, releaseId]);
  }
  const cleanChangelog = typeof changelog === 'string' ? sanitizeChangelogHtml(changelog.substring(0, CHANGELOG_MAX_LENGTH)).trim() : '';
  if (cleanChangelog !== '') {
    await db.query('UPDATE releases SET changelog = ? WHERE id = ? AND changelog IS NULL', [cleanChangelog, releaseId]);
  }
}

/**
 * Apply a successful check: record it on the feed, and move latest_version forwards only.
 * @param {object} feed from ReleaseFeed.findByComponentId()
 * @param {{version: string, releaseDate?: string, changelog?: string}} result version already normalised and parseable
 * @returns {Promise<{outcome: string, previous_version: string|null, latest_version: string|null}>}
 */
async function applyFeedSuccess(feed, { version, releaseDate = null, changelog = null }) {
  await ReleaseFeed.recordSuccess(feed.component_id, version);

  const previousVersion = feed.latest_version;
  const comparison = previousVersion === null ? 1 : compareVersions(version, previousVersion);
  let outcome = OUTCOMES.UNDECIDABLE;
  if (comparison === 1) {
    outcome = OUTCOMES.ADVANCED;
  } else if (comparison === 0) {
    outcome = OUTCOMES.UNCHANGED;
  } else if (comparison === -1) {
    outcome = OUTCOMES.OLDER;
  }

  let latestVersion = previousVersion;
  if (outcome === OUTCOMES.ADVANCED) {
    latestVersion = version;
    await db.query('UPDATE components SET latest_version = ?, latest_version_at = CURRENT_TIMESTAMP, latest_version_source = ? WHERE id = ?', [
      version,
      feed.feed_type,
      feed.component_id,
    ]);
  } else if (outcome === OUTCOMES.UNCHANGED) {
    await db.query('UPDATE components SET latest_version_at = CURRENT_TIMESTAMP, latest_version_source = ? WHERE id = ?', [feed.feed_type, feed.component_id]);
  }

  if (outcome === OUTCOMES.ADVANCED || outcome === OUTCOMES.UNCHANGED) {
    // resolve() applies stored vulnerability ranges to a release it creates
    const { release } = await Release.resolve(feed.component_id, latestVersion);
    await fillReleaseDetails(parseInt(release.id, 10), { releaseDate, changelog });
  }

  return { outcome, previous_version: previousVersion, latest_version: latestVersion };
}

module.exports = {
  OUTCOMES,
  CHANGELOG_MAX_LENGTH,
  validateFeedSettings,
  applyFeedSuccess,
};
