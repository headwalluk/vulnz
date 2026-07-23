const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth } = require('../middleware/auth');
const { getWordPressVersionInfo } = require('../lib/wpcore');
const { getBlindSpots } = require('../lib/watchlist');

const PLUGIN_TYPE = 'wordpress-plugin';
const MANIFEST_MAX_AGE_SECONDS = 300;

/**
 * Normalise a DB datetime (Date from MariaDB, string from SQLite) to an
 * ISO 8601 string, or null when absent/unparseable.
 */
function toIso(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  // A bare 'YYYY-MM-DD HH:MM:SS' string (SQLite, or a MySQL string column)
  // is stored in UTC, but new Date() would read it as local time. Pin it to
  // UTC explicitly. MariaDB returns Date objects, handled above.
  const str = String(value).trim();
  const isoish = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str) ? `${str.replace(' ', 'T')}Z` : str;
  const date = new Date(isoish);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isNewer(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  return candidate > current;
}

/**
 * @swagger
 * /api/wordpress/latest-versions:
 *   get:
 *     summary: Latest WordPress core and monitored plugin versions (fleet fast-update manifest)
 *     description: >
 *       Returns the current WordPress core version plus the latest known
 *       version of every high-priority (watchlist) plugin tracked from
 *       wordpress.org. Intended to be polled hourly by fleet hosts, which
 *       compare it against their own installed inventory and trigger an
 *       immediate update when anything is behind — short-circuiting the
 *       normal overnight cycle.
 *
 *
 *       The response is a manifest, not an instruction: the host owns the
 *       comparison and all local update guards. `blind_spots` lists
 *       watchlist slugs that cannot be tracked via the wordpress.org API
 *       (premium or missing), so their absence is never mistaken for
 *       up-to-date. `generated_at` reflects when the underlying data last
 *       changed (not request time), so the body and its ETag are stable
 *       until something actually moves.
 *     tags:
 *       - WordPress
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: The version manifest
 *         headers:
 *           Cache-Control:
 *             schema:
 *               type: string
 *             description: public, max-age=300
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 generated_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   example: '2026-07-23T14:00:00.000Z'
 *                 wordpress_core:
 *                   type: object
 *                   properties:
 *                     latest_version:
 *                       type: string
 *                       nullable: true
 *                       example: '7.0.2'
 *                 plugins:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       slug:
 *                         type: string
 *                         example: woocommerce
 *                       latest_version:
 *                         type: string
 *                         example: '10.9.5'
 *                       checked_at:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                 blind_spots:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ['elementor-pro', 'revslider']
 *       401:
 *         description: Unauthorized (missing or invalid API key)
 *       500:
 *         description: Server error
 */
router.get('/latest-versions', apiAuth, async (req, res) => {
  try {
    const versionInfo = await getWordPressVersionInfo();

    const plugins = await db.query(
      `SELECT slug, latest_version, latest_version_at
       FROM components
       WHERE component_type_slug = ?
         AND sync_priority_slug = 'high'
         AND latest_version IS NOT NULL
       ORDER BY slug ASC`,
      [PLUGIN_TYPE]
    );

    const blindSpots = await getBlindSpots();

    // Deterministic timestamp: the freshest underlying data change, so the
    // body (and its auto-generated ETag) stays identical until data moves.
    let dataChangedAt = null;
    for (const plugin of plugins) {
      if (isNewer(plugin.latest_version_at, dataChangedAt)) {
        dataChangedAt = plugin.latest_version_at;
      }
    }
    const coreRows = await db.query(`SELECT updated_at FROM app_settings WHERE setting_key = 'wordpress.current_version'`);
    const coreUpdatedAt = Array.isArray(coreRows) && coreRows.length > 0 ? coreRows[0].updated_at : null;
    if (isNewer(coreUpdatedAt, dataChangedAt)) {
      dataChangedAt = coreUpdatedAt;
    }

    res.set('Cache-Control', `public, max-age=${MANIFEST_MAX_AGE_SECONDS}`);
    res.json({
      generated_at: toIso(dataChangedAt),
      wordpress_core: { latest_version: versionInfo.latest },
      plugins: plugins.map((plugin) => ({
        slug: plugin.slug,
        latest_version: plugin.latest_version,
        checked_at: toIso(plugin.latest_version_at),
      })),
      blind_spots: blindSpots,
    });
  } catch (err) {
    console.error('Error building WordPress latest-versions manifest:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
