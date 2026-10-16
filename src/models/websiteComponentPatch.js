const db = require('../db');

/**
 * Patched installs (M30): a release on one website marked as patched in place.
 * The table is created by migration 20261016100000; reads join it to website_components.
 */

/** The releases of one component currently installed on a website. */
const findInstalledReleases = async (websiteId, componentType, slug) => {
  const rows = await db.query(
    `SELECT r.id AS release_id, r.version
     FROM website_components wc
     JOIN releases r ON wc.release_id = r.id
     JOIN components c ON r.component_id = c.id
     WHERE wc.website_id = ? AND c.component_type_slug = ? AND c.slug = ?
     ORDER BY r.version ASC`,
    [websiteId, componentType, slug]
  );
  return rows.map((row) => ({ release_id: parseInt(row.release_id, 10), version: row.version }));
};

/**
 * Mark an installed release as patched; an existing mark keeps its original time and author.
 * @returns {Promise<boolean>} true when the mark is new
 */
const mark = async (websiteId, releaseId, userId) => {
  const result = await db.query('INSERT IGNORE INTO website_component_patches (website_id, release_id, patched_at, patched_by_user_id) VALUES (?, ?, CURRENT_TIMESTAMP, ?)', [
    websiteId,
    releaseId,
    userId,
  ]);
  return (result.affectedRows || 0) > 0;
};

/**
 * Remove the patched mark from every release of one component on a website.
 * @returns {Promise<number>} marks removed
 */
const unmark = async (websiteId, componentType, slug) => {
  const result = await db.query(
    `DELETE FROM website_component_patches
     WHERE website_id = ?
       AND release_id IN (SELECT r.id FROM releases r JOIN components c ON r.component_id = c.id WHERE c.component_type_slug = ? AND c.slug = ?)`,
    [websiteId, componentType, slug]
  );
  return result.affectedRows || 0;
};

/** Every patched install on a website, with who marked it. */
const findForWebsite = async (websiteId) => {
  const rows = await db.query(
    `SELECT c.slug, c.title, c.component_type_slug, r.version, p.patched_at, u.username AS patched_by
     FROM website_component_patches p
     JOIN releases r ON p.release_id = r.id
     JOIN components c ON r.component_id = c.id
     LEFT JOIN users u ON p.patched_by_user_id = u.id
     WHERE p.website_id = ?
     ORDER BY c.component_type_slug ASC, c.slug ASC, r.version ASC`,
    [websiteId]
  );
  return rows.map((row) => ({ ...row, patched_by: row.patched_by || null }));
};

/** Drop marks for releases no longer installed on the website, so a reinstalled copy is not shown as patched. */
const clearUninstalled = async (websiteId) => {
  await db.query('DELETE FROM website_component_patches WHERE website_id = ? AND release_id NOT IN (SELECT release_id FROM website_components WHERE website_id = ?)', [
    websiteId,
    websiteId,
  ]);
};

module.exports = {
  findInstalledReleases,
  mark,
  unmark,
  findForWebsite,
  clearUninstalled,
};
