'use strict';

/**
 * Feed Model
 *
 * Diagnostic query functions for inspecting database state and ingestion health.
 * Used by the CLI's feed:status, component:find, and release:list commands.
 */

const db = require('../db');

/**
 * Get a high-level summary of the feed / database state.
 *
 * Returns component, release, and vulnerability counts along with the
 * most recent wordpress.org sync timestamp (a reasonable proxy for
 * "when was the Wordfence feed last processed").
 *
 * @returns {Promise<{components: number, releases: number, vulnerabilities: number, lastSyncedAt: Date|null}>}
 */
const getStatus = async () => {
  const componentRows = await db.query('SELECT COUNT(*) AS total FROM components');
  const releaseRows = await db.query('SELECT COUNT(*) AS total FROM releases');
  const vulnRows = await db.query('SELECT COUNT(*) AS total FROM vulnerabilities');
  const syncRows = await db.query('SELECT MAX(synced_from_wporg_at) AS last_synced FROM components');

  return {
    components: Number(componentRows[0].total),
    releases: Number(releaseRows[0].total),
    vulnerabilities: Number(vulnRows[0].total),
    lastSyncedAt: syncRows[0].last_synced || null,
  };
};

/**
 * Find a component by its slug (exact match).
 *
 * Returns an array — a given slug may exist as both a plugin and a theme
 * (different component_type_slug values), so we return all matches.
 *
 * @param {string} slug - The component slug to look up
 * @returns {Promise<Array<{id: number, slug: string, type: string, title: string, url: string|null, releaseCount: number, vulnCount: number}>>}
 */
const findComponentBySlug = async (slug) => {
  const rows = await db.query(
    `SELECT c.id, c.slug, c.component_type_slug, c.title, c.url,
            COUNT(DISTINCT r.id)  AS release_count,
            COUNT(DISTINCT v.id)  AS vuln_count
     FROM components c
     LEFT JOIN releases r      ON c.id = r.component_id
     LEFT JOIN vulnerabilities v ON r.id = v.release_id
     WHERE c.slug = ?
     GROUP BY c.id, c.slug, c.component_type_slug, c.title, c.url`,
    [slug]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    slug: row.slug,
    type: row.component_type_slug,
    title: row.title,
    url: row.url || null,
    releaseCount: Number(row.release_count),
    vulnCount: Number(row.vuln_count),
  }));
};

/**
 * List all known releases for a component slug.
 *
 * Includes per-release vulnerability counts so the caller can see at a
 * glance which versions have known issues.
 *
 * @param {string} slug - The component slug
 * @returns {Promise<Array<{id: number, version: string, vulnCount: number, slug: string, title: string, type: string}>>}
 */
const listReleasesBySlug = async (slug) => {
  const rows = await db.query(
    `SELECT r.id, r.version,
            COUNT(v.id)            AS vuln_count,
            c.slug, c.title, c.component_type_slug
     FROM components c
     JOIN  releases r      ON c.id = r.component_id
     LEFT JOIN vulnerabilities v ON r.id = v.release_id
     WHERE c.slug = ?
     GROUP BY r.id, r.version, c.slug, c.title, c.component_type_slug
     ORDER BY r.version DESC`,
    [slug]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    version: row.version,
    vulnCount: Number(row.vuln_count),
    slug: row.slug,
    title: row.title,
    type: row.component_type_slug,
  }));
};

module.exports = {
  getStatus,
  findComponentBySlug,
  listReleasesBySlug,
};
