const db = require('../db');
const appSetting = require('../models/appSetting');
const { parseIntEnv } = require('./env');
const { wporgConfig, syncPluginComponent } = require('./wporg');

const PLUGIN_TYPE = 'wordpress-plugin';
const STATIC_WATCHLIST_KEY = 'wporg.watchlist_static';

/**
 * The hand-maintained "always monitor" list, from app settings.
 * Comma-separated slugs, lower-cased and de-duplicated.
 */
async function getStaticWatchlist() {
  const raw = await appSetting.get(STATIC_WATCHLIST_KEY);
  if (!raw) {
    return [];
  }
  return [
    ...new Set(
      String(raw)
        .split(',')
        .map((slug) => slug.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/**
 * Plugin components ranked by production install count (all tenants,
 * dev sites excluded). Capped at a scan limit — enough headroom to find
 * `size` watchable plugins past any premium/blind-spot entries.
 */
async function getTopInstalledPlugins(scanLimit) {
  return db.query(
    `SELECT c.id, c.slug, c.wporg_available, COUNT(DISTINCT w.id) AS install_count
     FROM components c
     JOIN releases r ON r.component_id = c.id
     JOIN website_components wc ON wc.release_id = r.id
     JOIN websites w ON w.id = wc.website_id
     WHERE c.component_type_slug = ?
       AND w.is_dev = 0
     GROUP BY c.id, c.slug, c.wporg_available
     ORDER BY install_count DESC, c.slug ASC
     LIMIT ?`,
    [PLUGIN_TYPE, scanLimit]
  );
}

async function getPluginComponentBySlug(slug) {
  const rows = await db.query('SELECT id, slug, wporg_available FROM components WHERE slug = ? AND component_type_slug = ? LIMIT 1', [slug, PLUGIN_TYPE]);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Promote the given component ids to the high-priority sync lane and demote
 * every other plugin back to low, so the lane tracks the current watchlist
 * as install counts shift over time.
 */
async function applyPriorities(highComponentIds) {
  await db.query(`UPDATE components SET sync_priority_slug = 'low' WHERE component_type_slug = ? AND sync_priority_slug = 'high'`, [PLUGIN_TYPE]);

  const ids = [...highComponentIds];
  if (ids.length === 0) {
    return;
  }
  const placeholders = ids.map(() => '?').join(', ');
  await db.query(`UPDATE components SET sync_priority_slug = 'high' WHERE id IN (${placeholders})`, ids);
}

/**
 * Rebuild the high-priority watchlist:
 *   high lane = static "always monitor" list
 *             ∪ top-N watchable plugins by production install count
 *
 * Non-wordpress.org (premium) and missing slugs cannot be watched via the
 * wordpress.org API — they are surfaced as blind spots rather than silently
 * omitted, and are NOT placed in the wordpress.org sync lane (they would
 * only 404). Their release data comes from the Wordfence feed instead.
 *
 * Availability is resolved from the cached wporg_available flag, probing
 * wordpress.org only for components whose availability is still unknown.
 *
 * @returns {Promise<{high: string[], blindSpots: string[], staticCount: number, derivedCount: number, probed: number}>}
 */
async function buildWatchlist({ fetchImpl, size } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();
  const targetSize = size || parseIntEnv('WPORG_WATCHLIST_SIZE', { min: 1, default: 20 });
  const scanLimit = parseIntEnv('WPORG_WATCHLIST_SCAN_LIMIT', { min: targetSize, default: 100 });

  const state = { probed: 0 };

  // Resolve availability, probing wordpress.org (which also captures the
  // latest version) only when we have never checked this component.
  async function ensureAvailability(component) {
    if (component.wporg_available === 1) return true;
    if (component.wporg_available === 0) return false;
    const result = await syncPluginComponent(component, fetch, config);
    state.probed++;
    return result.available === true;
  }

  const highComponentIds = new Set();
  const highSlugs = [];
  const blindSpots = [];
  const seen = new Set();

  const staticSlugs = await getStaticWatchlist();
  for (const slug of staticSlugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const component = await getPluginComponentBySlug(slug);
    if (!component) {
      // Intent to monitor, but no component exists to sync yet.
      blindSpots.push(slug);
      continue;
    }
    const available = await ensureAvailability(component);
    if (available) {
      highComponentIds.add(component.id);
      highSlugs.push(slug);
    } else {
      blindSpots.push(slug);
    }
  }

  const ranked = await getTopInstalledPlugins(scanLimit);
  let derivedCount = 0;
  for (const row of ranked) {
    if (derivedCount >= targetSize) break;
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    const available = await ensureAvailability(row);
    if (available) {
      highComponentIds.add(row.id);
      highSlugs.push(row.slug);
      derivedCount++;
    } else {
      blindSpots.push(row.slug);
    }
  }

  await applyPriorities(highComponentIds);

  return {
    high: highSlugs,
    blindSpots,
    staticCount: staticSlugs.length,
    derivedCount,
    probed: state.probed,
  };
}

module.exports = {
  getStaticWatchlist,
  getTopInstalledPlugins,
  buildWatchlist,
};
