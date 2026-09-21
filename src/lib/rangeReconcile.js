/**
 * Remove vulnerability rows that their advisory's stored ranges no longer cover.
 *
 * Rules and rationale: docs/version-matching.md#cleaning-up-rows-the-ranges-do-not-cover
 */

const db = require('../db');
const { isVersionInRange } = require('./versionCompare');

const COMPONENT_CHUNK_SIZE = 200;
const DELETE_BATCH_SIZE = 1000;
const DEFAULT_SAMPLE_SIZE = 20;
const OUTCOME_KEEP = 'keep';
const OUTCOME_DELETE = 'delete';
const OUTCOME_UNDECIDABLE = 'undecidable';

/** Lookup key for a component's ranges under one URL; URLs compare case-insensitively, as in MariaDB. */
function rangeKey(componentId, url) {
  return `${String(componentId)}\n${String(url).toLowerCase()}`;
}

/**
 * Decide a row against every range its component has for the row's URL.
 *
 * @returns {'keep'|'delete'|'undecidable'} undecidable rows are kept
 */
function classifyRow(version, ranges) {
  const outcomes = ranges.map((range) => isVersionInRange(version, range));
  let outcome = OUTCOME_DELETE;
  if (outcomes.includes(true)) {
    outcome = OUTCOME_KEEP;
  } else if (outcomes.includes(null)) {
    outcome = OUTCOME_UNDECIDABLE;
  }
  return outcome;
}

/** Comma-separated placeholders for an IN list. */
function placeholders(values) {
  return values.map(() => '?').join(', ');
}

/** Delete vulnerability rows by id in batches, returning how many were removed. */
async function deleteRows(rowIds) {
  let deleted = 0;
  for (let start = 0; start < rowIds.length; start += DELETE_BATCH_SIZE) {
    const batch = rowIds.slice(start, start + DELETE_BATCH_SIZE);
    const result = await db.query(`DELETE FROM vulnerabilities WHERE id IN (${placeholders(batch)})`, batch);
    deleted += result.affectedRows || 0;
  }
  return deleted;
}

/**
 * Find, and with `apply` delete, vulnerability rows whose URL has stored ranges on the
 * same component but whose release none of those ranges covers.
 *
 * @param {object} [options]
 * @param {boolean} [options.apply] delete the rows; otherwise only report them
 * @param {string|null} [options.componentSlug] limit to components with this slug
 * @param {number} [options.sampleSize] how many example rows to return per outcome
 * @returns {Promise<object>} counts, per-component totals and samples
 */
async function reconcileRangeVulnerabilities({ apply = false, componentSlug = null, sampleSize = DEFAULT_SAMPLE_SIZE } = {}) {
  const summary = {
    applied: apply,
    componentsWithRanges: 0,
    rowsChecked: 0,
    kept: 0,
    undecidable: 0,
    toDelete: 0,
    deleted: 0,
    byComponent: [],
    deleteSample: [],
    undecidableSample: [],
  };

  const componentFilter = componentSlug ? 'WHERE vr.component_id IN (SELECT id FROM components WHERE slug = ?)' : '';
  const componentRows = await db.query(
    `SELECT DISTINCT vr.component_id FROM vulnerability_ranges vr ${componentFilter} ORDER BY vr.component_id`,
    componentSlug ? [componentSlug] : []
  );
  const componentIds = componentRows.map((row) => row.component_id);
  summary.componentsWithRanges = componentIds.length;

  const perComponent = new Map();

  for (let start = 0; start < componentIds.length; start += COMPONENT_CHUNK_SIZE) {
    const chunk = componentIds.slice(start, start + COMPONENT_CHUNK_SIZE);

    const rangeRows = await db.query(
      `SELECT component_id, url, from_version, from_inclusive, to_version, to_inclusive FROM vulnerability_ranges WHERE component_id IN (${placeholders(chunk)})`,
      chunk
    );
    const rangesByKey = new Map();
    for (const row of rangeRows) {
      const key = rangeKey(row.component_id, row.url);
      if (!rangesByKey.has(key)) {
        rangesByKey.set(key, []);
      }
      rangesByKey.get(key).push({
        fromVersion: row.from_version,
        fromInclusive: !!row.from_inclusive,
        toVersion: row.to_version,
        toInclusive: !!row.to_inclusive,
      });
    }

    const vulnerabilityRows = await db.query(
      `SELECT v.id, v.url, r.version, r.component_id, c.slug, c.component_type_slug
       FROM vulnerabilities v
       JOIN releases r ON r.id = v.release_id
       JOIN components c ON c.id = r.component_id
       WHERE r.component_id IN (${placeholders(chunk)})`,
      chunk
    );

    const chunkDeleteIds = [];
    for (const row of vulnerabilityRows) {
      const ranges = rangesByKey.get(rangeKey(row.component_id, row.url));
      if (!ranges) {
        // No ranges for this URL on this component: another source's row, left alone.
        continue;
      }
      summary.rowsChecked++;
      const outcome = classifyRow(row.version, ranges);
      const componentKey = String(row.component_id);
      if (!perComponent.has(componentKey)) {
        perComponent.set(componentKey, { slug: row.slug, type: row.component_type_slug, toDelete: 0, undecidable: 0 });
      }
      const componentTotals = perComponent.get(componentKey);
      const example = { type: row.component_type_slug, slug: row.slug, version: row.version, url: row.url };

      if (outcome === OUTCOME_KEEP) {
        summary.kept++;
      } else if (outcome === OUTCOME_UNDECIDABLE) {
        summary.undecidable++;
        componentTotals.undecidable++;
        if (summary.undecidableSample.length < sampleSize) {
          summary.undecidableSample.push(example);
        }
      } else {
        summary.toDelete++;
        componentTotals.toDelete++;
        chunkDeleteIds.push(row.id);
        if (summary.deleteSample.length < sampleSize) {
          summary.deleteSample.push(example);
        }
      }
    }

    if (apply && chunkDeleteIds.length > 0) {
      summary.deleted += await deleteRows(chunkDeleteIds);
    }
  }

  summary.byComponent = Array.from(perComponent.values())
    .filter((totals) => totals.toDelete > 0 || totals.undecidable > 0)
    .sort((left, right) => right.toDelete - left.toDelete || left.slug.localeCompare(right.slug));

  return summary;
}

module.exports = {
  classifyRow,
  reconcileRangeVulnerabilities,
};
