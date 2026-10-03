const db = require('../db');
const Advisory = require('../models/advisory');
const { COUNTED_COMPONENT_TYPES } = require('../models/website');

const SEVERITY_BUCKETS = ['critical', 'high', 'medium', 'low', 'none', 'unrated'];
const RATED_BUCKETS = ['critical', 'high', 'medium', 'low', 'none'];

/** The highest of a set of ratings, or null when none is rated. */
const worstRating = (ratings) => ratings.filter(Boolean).sort((left, right) => Advisory.RATING_RANK[right] - Advisory.RATING_RANK[left])[0] || null;

/** An all-zero severity_counts object. */
const emptyCounts = () => Object.fromEntries(SEVERITY_BUCKETS.map((bucket) => [bucket, 0]));

/**
 * Severity per website, from the advisories on its installed plugins and themes.
 *
 * Each vulnerable component counts once, in the bucket of its worst advisory, so the counts add
 * up to vulnerability_count. `unrated` counts vulnerable components with no rated advisory at all;
 * `unrated_vulnerabilities` counts every vulnerability no rated advisory accounts for, so while it
 * is above 0 the site's max_cvss_rating is a lower bound.
 *
 * @param {number[]} websiteIds
 * @returns {Promise<Map<number, {max_cvss_rating: string|null, severity_counts: object, unrated_vulnerabilities: number}>>}
 */
async function severityForWebsites(websiteIds) {
  const result = new Map(websiteIds.map((websiteId) => [websiteId, { max_cvss_rating: null, severity_counts: emptyCounts(), unrated_vulnerabilities: 0 }]));
  if (websiteIds.length === 0) {
    return result;
  }

  const installs = await db.query(
    `SELECT wc.website_id, wc.release_id, c.id AS component_id
     FROM website_components wc
     JOIN releases r ON wc.release_id = r.id
     JOIN components c ON r.component_id = c.id
     WHERE wc.website_id IN (?) AND c.component_type_slug IN (?)`,
    [websiteIds, COUNTED_COMPONENT_TYPES]
  );
  const severityByRelease = await Advisory.severityForReleases([...new Set(installs.map((install) => parseInt(install.release_id, 10)))]);

  // A site may report two releases of one component mid-upgrade; the component takes the worse
  const componentsBySite = new Map();
  for (const install of installs) {
    const severity = severityByRelease.get(parseInt(install.release_id, 10));
    if (!severity) {
      continue;
    }
    const websiteId = parseInt(install.website_id, 10);
    if (!componentsBySite.has(websiteId)) {
      componentsBySite.set(websiteId, new Map());
    }
    const components = componentsBySite.get(websiteId);
    const componentId = parseInt(install.component_id, 10);
    const existing = components.get(componentId) || { ratings: [], unratedVulnerabilities: 0 };
    existing.ratings.push(severity.max_cvss_rating);
    existing.unratedVulnerabilities += severity.unrated_vulnerabilities;
    components.set(componentId, existing);
  }

  for (const [websiteId, components] of componentsBySite) {
    const summary = result.get(websiteId);
    for (const component of components.values()) {
      const rating = worstRating(component.ratings);
      summary.severity_counts[rating && RATED_BUCKETS.includes(rating) ? rating : 'unrated']++;
      summary.unrated_vulnerabilities += component.unratedVulnerabilities;
    }
    summary.max_cvss_rating = worstRating(RATED_BUCKETS.filter((bucket) => summary.severity_counts[bucket] > 0));
  }
  return result;
}

module.exports = { severityForWebsites, worstRating, SEVERITY_BUCKETS };
