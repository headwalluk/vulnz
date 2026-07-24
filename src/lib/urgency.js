const db = require('../db');
const { parseIntEnv } = require('./env');
const { runTask, isLlmAvailable } = require('./llm/client');

const URGENCY_TASK_SLUG = 'release-urgency';
const PLUGIN_TYPE = 'wordpress-plugin';
const HIGH_PRIORITY = 'high';

const DEFAULT_CLASSIFY_BATCH_SIZE = 10;
const MIN_CLASSIFY_BATCH_SIZE = 1;
const MAX_CLASSIFY_BATCH_SIZE = 100;

const SOURCE_CHANGELOG_LLM = 'changelog_llm';
const SOURCE_KEYWORD_OVERRIDE = 'keyword_override';
const SOURCE_MANUAL = 'manual';
const SOURCE_NONE = 'none';

/**
 * Phrases that force `is_urgent` regardless of the model's verdict.
 *
 * This is a floor, not a filter: it only ever raises a release to urgent,
 * never lowers one. The asymmetry is deliberate — a false positive costs one
 * unnecessary out-of-cycle update, while a false negative leaves the fleet
 * exposed for the rest of the day, which is the exact failure this system
 * exists to prevent.
 *
 * Kept deliberately short. Anything that could plausibly describe a routine
 * dependency bump (a bare CVE reference, the word "security" on its own) is
 * excluded, because forcing those urgent would reintroduce the noise the
 * classifier is there to remove.
 */
const URGENT_KEYWORDS = ['remote code execution', 'sql injection', 'authentication bypass', 'privilege escalation', 'arbitrary file upload'];

const KEYWORD_OVERRIDE_SUMMARY = 'Changelog names a critical vulnerability class; flagged urgent automatically.';

function classifyConfig() {
  return {
    batchSize: parseIntEnv('LLM_CLASSIFY_BATCH_SIZE', {
      min: MIN_CLASSIFY_BATCH_SIZE,
      max: MAX_CLASSIFY_BATCH_SIZE,
      default: DEFAULT_CLASSIFY_BATCH_SIZE,
    }),
  };
}

/**
 * Does the changelog contain a phrase that is urgent on its face?
 * @param {string} changelog
 * @returns {boolean}
 */
function hasUrgentKeyword(changelog) {
  if (typeof changelog !== 'string' || changelog === '') {
    return false;
  }
  const haystack = changelog.toLowerCase();
  return URGENT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Releases awaiting classification: high-priority plugins only, with a
 * changelog captured and no verdict yet. The fast lane is the only lane that
 * feeds the fleet manifest, so the ~1,100 background components are never
 * classified and never cost anything.
 *
 * @param {number} limit
 * @returns {Promise<Array<{id:number, version:string, changelog:string, slug:string}>>}
 */
async function findPendingReleases(limit) {
  const rows = await db.query(
    `SELECT releases.id, releases.version, releases.changelog, components.slug
     FROM releases
     JOIN components ON components.id = releases.component_id
     WHERE components.component_type_slug = ?
       AND components.sync_priority_slug = ?
       AND releases.changelog IS NOT NULL
       AND releases.urgency_checked_at IS NULL
     ORDER BY releases.id DESC
     LIMIT ?`,
    [PLUGIN_TYPE, HIGH_PRIORITY, limit]
  );
  return Array.isArray(rows) ? rows : [];
}

/**
 * How many releases are waiting to be classified?
 * @returns {Promise<number>}
 */
async function countPendingReleases() {
  const rows = await db.query(
    `SELECT COUNT(*) AS pending
     FROM releases
     JOIN components ON components.id = releases.component_id
     WHERE components.component_type_slug = ?
       AND components.sync_priority_slug = ?
       AND releases.changelog IS NOT NULL
       AND releases.urgency_checked_at IS NULL`,
    [PLUGIN_TYPE, HIGH_PRIORITY]
  );
  return Array.isArray(rows) && rows.length > 0 ? Number(rows[0].pending) : 0;
}

/**
 * Look up a stored release by plugin slug and version, with whatever
 * changelog and verdict it already carries.
 *
 * @param {string} slug
 * @param {string} version
 * @returns {Promise<object|undefined>}
 */
async function findStoredRelease(slug, version) {
  const rows = await db.query(
    `SELECT releases.id, releases.version, releases.changelog, releases.is_urgent,
            releases.urgency_summary, releases.urgency_source_slug, releases.urgency_checked_at,
            components.slug
     FROM releases
     JOIN components ON components.id = releases.component_id
     WHERE components.slug = ?
       AND components.component_type_slug = ?
       AND releases.version = ?
     LIMIT 1`,
    [slug, PLUGIN_TYPE, version]
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
}

/**
 * Persist a verdict against a release.
 * @param {number} releaseId
 * @param {{is_urgent:boolean, summary:string, source:string}} verdict
 */
async function saveVerdict(releaseId, verdict) {
  await db.query(
    `UPDATE releases
     SET is_urgent = ?, urgency_summary = ?, urgency_source_slug = ?, urgency_checked_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [verdict.is_urgent ? 1 : 0, verdict.summary, verdict.source, releaseId]
  );
}

/**
 * Classify one changelog. Does not touch the database — callers decide
 * whether to persist, which is what makes the CLI's dry-run mode possible.
 *
 * @param {{slug:string, version:string, changelog:string}} release
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<{ok:boolean, verdict:object|null, model:string|null, error:string|null}>}
 */
async function classifyRelease({ slug, version, changelog }, { fetchImpl } = {}) {
  const outcome = await runTask(URGENCY_TASK_SLUG, { slug, version, changelog }, { fetchImpl });

  if (!outcome.ok) {
    return { ok: false, verdict: null, model: outcome.model, error: outcome.error };
  }

  const keywordHit = hasUrgentKeyword(changelog);
  const isUrgent = outcome.result.is_urgent || keywordHit;

  // Record the override as the source only when it actually changed the
  // outcome, so the audit trail shows which releases the model would have
  // let through.
  const source = !outcome.result.is_urgent && keywordHit ? SOURCE_KEYWORD_OVERRIDE : SOURCE_CHANGELOG_LLM;
  const summary = !outcome.result.is_urgent && keywordHit ? KEYWORD_OVERRIDE_SUMMARY : outcome.result.summary;

  return {
    ok: true,
    verdict: { is_urgent: isUrgent, summary, source },
    model: outcome.model,
    error: null,
  };
}

/**
 * Drain the pending-classification queue.
 *
 * Runs on its own schedule rather than inside the wordpress.org sync, so a
 * slow or unavailable provider never delays the sync that feeds the manifest.
 * Releases that fail to classify keep a NULL `urgency_checked_at` and are
 * retried on the next pass; until then they report as not urgent, which
 * leaves the fleet on its existing overnight cycle.
 *
 * @param {object} [options]
 * @param {number} [options.limit] overrides LLM_CLASSIFY_BATCH_SIZE
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<{classified:number, urgent:number, failed:number, skipped:boolean, reason:string|null}>}
 */
async function classifyPendingReleases({ limit, fetchImpl } = {}) {
  const summary = { classified: 0, urgent: 0, failed: 0, skipped: false, reason: null };

  if (!isLlmAvailable()) {
    summary.skipped = true;
    summary.reason = 'LLM support is disabled or no provider API key is configured.';
    return summary;
  }

  const batchSize = typeof limit === 'number' && limit > 0 ? limit : classifyConfig().batchSize;

  let pending;
  try {
    pending = await findPendingReleases(batchSize);
  } catch (err) {
    console.error('Error loading releases pending urgency classification:', err);
    summary.skipped = true;
    summary.reason = err.message;
    return summary;
  }

  for (const release of pending) {
    try {
      const outcome = await classifyRelease(release, { fetchImpl });
      if (!outcome.ok) {
        summary.failed++;
        console.error(`Urgency classification failed for ${release.slug} ${release.version}: ${outcome.error}`);
        continue;
      }

      await saveVerdict(release.id, outcome.verdict);
      summary.classified++;
      if (outcome.verdict.is_urgent) {
        summary.urgent++;
        console.log(`URGENT: ${release.slug} ${release.version} — ${outcome.verdict.summary}`);
      }
    } catch (err) {
      summary.failed++;
      console.error(`Error classifying ${release.slug} ${release.version}:`, err);
    }
  }

  return summary;
}

module.exports = {
  classifyRelease,
  classifyPendingReleases,
  countPendingReleases,
  findPendingReleases,
  findStoredRelease,
  saveVerdict,
  hasUrgentKeyword,
  URGENT_KEYWORDS,
  SOURCE_CHANGELOG_LLM,
  SOURCE_KEYWORD_OVERRIDE,
  SOURCE_MANUAL,
  SOURCE_NONE,
};
