/**
 * Report releases that the pre-1.40.0 version rewrite may have created.
 *
 * Read-only. See docs/version-matching.md#phantom-releases.
 */

const db = require('../db');

/** The rewrite sanitizeVersion() applied before v1.40.0, kept only to find the rows it created. */
function legacySanitizeVersion(version) {
  let sanitized = String(version)
    .replace(/[^0-9.]+[a-z]+[0-9]+/g, '')
    .replace(/[^0-9.]/g, '');
  if (sanitized.startsWith('.')) {
    sanitized = `0${sanitized}`;
  }
  if (sanitized.endsWith('.')) {
    sanitized = `${sanitized}0`;
  }
  return sanitized === '' ? '0' : sanitized;
}

/**
 * Pair each raw release with the release its old rewrite would have produced, where both exist.
 *
 * @param {{component_id: *, version: string}[]} rawReleases releases stored with non-numeric characters
 * @param {Set<string>} existingKeys `${component_id}\n${version}` for every release of those components
 * @returns {{componentId: string, rawVersion: string, rewrittenVersion: string}[]}
 */
function pairWithRewrites(rawReleases, existingKeys) {
  const pairs = [];
  for (const release of rawReleases) {
    const rewrittenVersion = legacySanitizeVersion(release.version);
    const componentId = String(release.component_id);
    if (rewrittenVersion !== release.version && existingKeys.has(`${componentId}\n${rewrittenVersion}`)) {
      pairs.push({ componentId, rawVersion: release.version, rewrittenVersion });
    }
  }
  return pairs;
}

/**
 * List releases that may be phantoms of a raw sibling, with the evidence for deciding.
 *
 * @returns {Promise<object[]>} one entry per pair: component, both versions, and the suspect's installs and vulnerability rows
 */
async function findPhantomReleaseCandidates() {
  // MariaDB REGEXP: versions containing anything other than digits and dots.
  const rawReleases = await db.query("SELECT component_id, version FROM releases WHERE version REGEXP '[^0-9.]'");
  const candidates = [];
  if (rawReleases.length > 0) {
    const componentIds = Array.from(new Set(rawReleases.map((release) => String(release.component_id))));
    const siblingRows = await db.query(`SELECT component_id, version FROM releases WHERE component_id IN (${componentIds.map(() => '?').join(', ')})`, componentIds);
    const existingKeys = new Set(siblingRows.map((row) => `${String(row.component_id)}\n${row.version}`));

    for (const pair of pairWithRewrites(rawReleases, existingKeys)) {
      const [evidence] = await db.query(
        `SELECT c.slug, c.component_type_slug AS type,
                (SELECT COUNT(*) FROM website_components wc WHERE wc.release_id = r.id) AS installs,
                (SELECT COUNT(*) FROM vulnerabilities v WHERE v.release_id = r.id) AS vulnerability_rows
         FROM releases r JOIN components c ON c.id = r.component_id
         WHERE r.component_id = ? AND r.version = ?`,
        [pair.componentId, pair.rewrittenVersion]
      );
      candidates.push({
        type: evidence.type,
        slug: evidence.slug,
        rawVersion: pair.rawVersion,
        suspectVersion: pair.rewrittenVersion,
        suspectInstalls: Number(evidence.installs),
        suspectVulnerabilityRows: Number(evidence.vulnerability_rows),
      });
    }
  }
  return candidates;
}

module.exports = {
  legacySanitizeVersion,
  pairWithRewrites,
  findPhantomReleaseCandidates,
};
