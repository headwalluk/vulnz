const express = require('express');
const router = express.Router();
const db = require('../db');
const { apiAuth } = require('../middleware/auth');
const { getWordPressVersionInfo } = require('../lib/wpcore');
const { getBlindSpots } = require('../lib/watchlist');

const PLUGIN_TYPE = 'wordpress-plugin';
const HIGH_PRIORITY = 'high';
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
 *
 *
 *       `is_urgent` marks a release that fixes a security vulnerability
 *       realistically exploitable against a default installation — the only
 *       case that justifies an immediate, out-of-cycle update rather than
 *       waiting for the host's normal overnight run. It is derived from the
 *       wordpress.org changelog, which carries no security flag of its own.
 *       It defaults to `false` whenever there is no evidence either way, so
 *       an unclassified or unclassifiable release always degrades to the
 *       existing overnight behaviour.
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
 *                       is_urgent:
 *                         type: boolean
 *                         description: >
 *                           True when this release fixes a security
 *                           vulnerability exploitable against a default
 *                           installation, and the host should update now
 *                           rather than waiting for its overnight cycle.
 *                         example: false
 *                       summary:
 *                         type: string
 *                         nullable: true
 *                         description: >
 *                           One-sentence description of what the release
 *                           contains. Null until the release has been
 *                           classified.
 *                         example: 'Adds bulk editing filters and fixes a link attribute bug.'
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
      `SELECT components.slug, components.latest_version, components.latest_version_at,
              releases.is_urgent, releases.urgency_summary, releases.urgency_checked_at
       FROM components
       LEFT JOIN releases
         ON releases.component_id = components.id
        AND releases.version = components.latest_version
       WHERE components.component_type_slug = ?
         AND components.sync_priority_slug = ?
         AND components.latest_version IS NOT NULL
       ORDER BY components.slug ASC`,
      [PLUGIN_TYPE, HIGH_PRIORITY]
    );

    const blindSpots = await getBlindSpots();

    // Deterministic timestamp: the freshest underlying data change, so the
    // body (and its auto-generated ETag) stays identical until data moves.
    // Urgency verdicts land ~20 minutes after the version itself, so they
    // count as a data change too.
    let dataChangedAt = null;
    for (const plugin of plugins) {
      if (isNewer(plugin.latest_version_at, dataChangedAt)) {
        dataChangedAt = plugin.latest_version_at;
      }
      if (isNewer(plugin.urgency_checked_at, dataChangedAt)) {
        dataChangedAt = plugin.urgency_checked_at;
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
        is_urgent: Boolean(plugin.is_urgent),
        summary: plugin.urgency_summary || null,
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
