const versionCompare = require('./versionCompare');
const appSetting = require('../models/appSetting');
const { parseStr, parseIntEnv } = require('./env');

// api.wordpress.org/core/stable-check/1.0/ returns a flat map of every
// released WordPress core version to one of three statuses:
//   'latest'   — exactly one version (the current release)
//   'outdated' — the final patch of an older-but-maintained branch
//                (superseded, but NOT vulnerable)
//   'insecure' — every earlier patch (known-vulnerable)
// We persist only the non-insecure ("safe") set — latest + outdated —
// because a version below latest that is not a listed branch-tip is
// insecure by WordPress's own model. That keeps the cache to ~24 entries
// instead of ~830 and stays correct as new insecure versions ship.
const STABLE_CHECK_ENDPOINT = '/core/stable-check/1.0/';

// A plausible WordPress core version: 2-4 dotted numeric segments.
const CORE_VERSION_RE = /^\d+(\.\d+){1,3}$/;

const CURRENT_VERSION_KEY = 'wordpress.current_version';
const CURRENT_VERSION_DESC = 'Current stable WordPress version';
const SAFE_VERSIONS_KEY = 'wordpress.safe_versions';
const SAFE_VERSIONS_DESC =
  'JSON map of non-insecure WordPress core versions to status (latest|outdated), from api.wordpress.org stable-check. Anything below latest and not listed is treated as insecure.';
const VERSIONS_CATEGORY = 'versions';

function wpOrgConfig() {
  return {
    baseUrl: parseStr('WPORG_API_BASE_URL', 'https://api.wordpress.org'),
    timeout: parseIntEnv('WPORG_TIMEOUT_MS', { min: 1000, default: 5000 }),
    userAgent: parseStr('WPORG_USER_AGENT', 'VULNZ/1.0'),
  };
}

/**
 * Reduce a raw stable-check response to the single latest version and the
 * safe-version map (latest + outdated only). Insecure entries are dropped.
 * @param {object} data - version -> status map from stable-check
 * @returns {{ latest: string|null, safeMap: Object<string,string> }}
 */
function parseStableCheck(data) {
  if (!data || typeof data !== 'object') {
    return { latest: null, safeMap: {} };
  }

  const safeMap = {};
  let latest = null;

  for (const [version, status] of Object.entries(data)) {
    if (!CORE_VERSION_RE.test(version)) {
      continue;
    }
    if (status === 'latest') {
      safeMap[version] = 'latest';
      // Exactly one is expected; if a malformed response marks several,
      // keep the highest so we never regress the current version.
      if (!latest || versionCompare(version, latest) > 0) {
        latest = version;
      }
    } else if (status === 'outdated') {
      safeMap[version] = 'outdated';
    }
    // 'insecure' (and anything unrecognised) is intentionally excluded.
  }

  return { latest, safeMap };
}

/**
 * Classify an installed WordPress core version against the safe-version map.
 * @param {string} installed - the site's WordPress core version
 * @param {{ latest: string|null, safeMap: Object<string,string> }} info
 * @returns {'latest'|'outdated'|'insecure'|'current'|'unknown'}
 *   - 'latest'/'outdated' — exact match in the safe map
 *   - 'current' — at or ahead of latest (e.g. a release we have not cached
 *     yet, or a nightly); not flagged
 *   - 'insecure' — below latest and not a listed branch-tip
 *   - 'unknown' — unparseable version string
 */
function classifyWordPressVersion(installed, info = {}) {
  const { latest = null, safeMap = {} } = info;

  if (!installed || typeof installed !== 'string' || !CORE_VERSION_RE.test(installed.trim())) {
    return 'unknown';
  }
  const version = installed.trim();

  if (safeMap && Object.prototype.hasOwnProperty.call(safeMap, version)) {
    return safeMap[version];
  }

  if (latest && CORE_VERSION_RE.test(latest) && versionCompare(version, latest) >= 0) {
    return 'current';
  }

  return 'insecure';
}

/**
 * Read the cached WordPress core version info from app settings.
 * @returns {Promise<{ latest: string|null, safeMap: Object<string,string> }>}
 */
async function getWordPressVersionInfo() {
  const latest = await appSetting.get(CURRENT_VERSION_KEY);
  const rawSafe = await appSetting.get(SAFE_VERSIONS_KEY);

  let safeMap = {};
  if (rawSafe) {
    try {
      const parsed = JSON.parse(rawSafe);
      if (parsed && typeof parsed === 'object') {
        safeMap = parsed;
      }
    } catch {
      safeMap = {};
    }
  }

  return { latest: latest || null, safeMap };
}

/**
 * Fetch stable-check from wordpress.org and persist the current version and
 * safe-version map. Fails safe: if the response is unreachable, non-200,
 * unparseable, or carries no 'latest' entry, existing settings are left
 * untouched rather than overwritten with junk.
 * @returns {Promise<{ ok: boolean, reason?: string, latest?: string, safeCount?: number }>}
 */
async function syncWordPressCoreVersion({ fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const { baseUrl, timeout, userAgent } = wpOrgConfig();
  const url = `${baseUrl}${STABLE_CHECK_ENDPOINT}`;

  let response;
  try {
    response = await fetch(url, { timeout, headers: { 'User-Agent': userAgent } });
  } catch (err) {
    console.error('WP core stable-check fetch failed:', err.message);
    return { ok: false, reason: 'fetch_error' };
  }

  if (response.status !== 200) {
    console.error(`WP core stable-check returned status ${response.status}; leaving version settings unchanged.`);
    return { ok: false, reason: `status_${response.status}` };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error('WP core stable-check returned invalid JSON:', err.message);
    return { ok: false, reason: 'invalid_json' };
  }

  const { latest, safeMap } = parseStableCheck(data);

  if (!latest) {
    console.error('WP core stable-check had no valid "latest" version; leaving version settings unchanged.');
    return { ok: false, reason: 'no_latest' };
  }

  await appSetting.set(CURRENT_VERSION_KEY, latest, 'string', CURRENT_VERSION_DESC, VERSIONS_CATEGORY, true);
  await appSetting.set(SAFE_VERSIONS_KEY, JSON.stringify(safeMap), 'string', SAFE_VERSIONS_DESC, VERSIONS_CATEGORY, true);

  if (process.env.LOG_LEVEL === 'info' || process.env.LOG_LEVEL === 'debug') {
    console.log(`WP core version synced: latest=${latest}, safe versions=${Object.keys(safeMap).length}`);
  }

  return { ok: true, latest, safeCount: Object.keys(safeMap).length };
}

module.exports = {
  parseStableCheck,
  classifyWordPressVersion,
  getWordPressVersionInfo,
  syncWordPressCoreVersion,
};
