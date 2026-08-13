const db = require('../db');
const { stripAll } = require('./sanitizer');
const { parseStr, parseIntEnv } = require('./env');

const WPORG_PLUGIN_PAGE_BASE = 'https://wordpress.org/plugins/';
const HIGH_PRIORITY = 'high';

/**
 * Resolve wordpress.org sync configuration from the environment.
 * All values normalised via src/lib/env.js rather than raw process.env.
 */
function wporgConfig() {
  return {
    baseUrl: parseStr('WPORG_API_BASE_URL', 'https://api.wordpress.org'),
    endpoint: parseStr('WPORG_PLUGIN_INFO_ENDPOINT', '/plugins/info/1.0/'),
    timeout: parseIntEnv('WPORG_TIMEOUT_MS', { min: 1000, default: 5000 }),
    userAgent: parseStr('WPORG_USER_AGENT', 'VULNZ/1.0'),
    batchSize: parseIntEnv('WPORG_UPDATE_BATCH_SIZE', { min: 1, default: 1 }),
    highPriorityDelayMs: parseIntEnv('WPORG_HIGH_PRIORITY_DELAY_MS', { min: 0, default: 250 }),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse WordPress.org date format to MySQL DATETIME
 * Input: "2025-11-13 1:39pm GMT" or "2025-11-13 11:39am GMT"
 * Output: "2025-11-13 13:39:00" (MySQL DATETIME format in UTC)
 *
 * Note: WordPress.org API always returns times in GMT/UTC.
 * Our MySQL connection is configured with timezone='Z' (UTC) to ensure
 * times are stored and compared correctly regardless of server timezone.
 */
function parseWpOrgDateTime(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  try {
    // Extract date part (YYYY-MM-DD), time part, and am/pm
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(am|pm)/i);
    if (!match) {
      return null;
    }

    const [, date, hours, minutes, period] = match;
    let hour = parseInt(hours, 10);

    // Convert to 24-hour format
    if (period.toLowerCase() === 'pm' && hour !== 12) {
      hour += 12;
    } else if (period.toLowerCase() === 'am' && hour === 12) {
      hour = 0;
    }

    return `${date} ${hour.toString().padStart(2, '0')}:${minutes}:00`;
  } catch (err) {
    console.error(`Error parsing WordPress.org date: ${dateStr}`, err);
    return null;
  }
}

/**
 * Parse WordPress.org date (YYYY-MM-DD format)
 * Input: "2025-10-19"
 * Output: "2025-10-19" (MySQL DATE format)
 */
function parseWpOrgDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  // Validate YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  return dateStr;
}

/**
 * Mark a component as synced from wordpress.org, recording whether it was
 * actually found there. wporg_available distinguishes "seen (200)" from
 * "absent (404)" — previously both collapsed into synced_from_wporg = 1,
 * which hid premium/blind-spot plugins.
 */
async function markSynced(componentId, available) {
  await db.query('UPDATE components SET synced_from_wporg = 1, synced_from_wporg_at = CURRENT_TIMESTAMP, wporg_available = ? WHERE id = ?', [available ? 1 : 0, componentId]);
}

/**
 * Record the current release version for a component: cache it on the
 * component row for direct manifest reads, and ensure a matching release
 * row exists so history and the vulnerability join stay consistent.
 *
 * When a changelog is supplied it is stored on the release row, but only if
 * that row does not already have one. That guard makes the write idempotent
 * across the hourly re-sync: a release is classified for urgency once, and a
 * later edit to the plugin's readme does not silently re-open the queue.
 *
 * @param {number} componentId
 * @param {string} rawVersion
 * @param {string|null} [changelog] raw wordpress.org changelog HTML
 */
async function recordLatestVersion(componentId, rawVersion, changelog = null) {
  const version = stripAll(String(rawVersion)).trim();
  if (!version) {
    return;
  }
  await db.query('UPDATE components SET latest_version = ?, latest_version_at = CURRENT_TIMESTAMP WHERE id = ?', [version, componentId]);
  // INSERT IGNORE leaves an existing release (and its release_date) intact.
  await db.query('INSERT IGNORE INTO releases (component_id, version) VALUES (?, ?)', [componentId, version]);

  if (typeof changelog === 'string' && changelog.trim() !== '') {
    await db.query('UPDATE releases SET changelog = ? WHERE component_id = ? AND version = ? AND changelog IS NULL', [changelog, componentId, version]);
  }
}

/**
 * Read-only check of whether a plugin slug is published on wordpress.org.
 *
 * Deliberately touches neither the database nor the component row, which is
 * what separates it from syncPluginComponent(): the malware CLI calls this
 * before flagging a component, and a fake plugin squatting on a real slug
 * must not end up with the genuine plugin's title and description written
 * over it.
 *
 * @param {string} slug
 * @returns {Promise<{status:number, available:boolean|null, name:string|null}>}
 *   available is true (published), false (absent), or null (couldn't tell —
 *   a timeout, rate limit, or 5xx).
 */
async function probeWpOrgSlug(slug, { fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();
  const url = `${config.baseUrl}${config.endpoint}${slug}.json`;

  const response = await fetch(url, {
    timeout: config.timeout,
    headers: { 'User-Agent': config.userAgent },
  });

  if (response.status === 404) {
    return { status: 404, available: false, name: null };
  }

  if (response.status !== 200) {
    return { status: response.status, available: null, name: null };
  }

  const data = await response.json();

  // wordpress.org sometimes answers 200 with an error body rather than 404.
  // Treating that as "published" would block a genuine malware flag, so it
  // is read as absent.
  if (!data || data.error) {
    return { status: 200, available: false, name: null };
  }

  return { status: 200, available: true, name: typeof data.name === 'string' ? stripAll(data.name) : null };
}

/**
 * Sync a single plugin component from wordpress.org. Shared by both the
 * background low-priority rotation and the hourly high-priority lane.
 * @returns {Promise<{slug:string, status:number, available:boolean|null, version:string|null}>}
 */
async function syncPluginComponent(component, fetch, config) {
  const url = `${config.baseUrl}${config.endpoint}${component.slug}.json`;
  const options = {
    timeout: config.timeout,
    headers: { 'User-Agent': config.userAgent },
  };

  if (process.env.LOG_LEVEL === 'info' || process.env.LOG_LEVEL === 'debug') {
    console.log(`Syncing plugin: ${component.slug}`);
  }

  const response = await fetch(url, options);

  if (response.status === 404) {
    await markSynced(component.id, false);
    return { slug: component.slug, status: 404, available: false, version: null };
  }

  if (response.status !== 200) {
    // Transient error (rate limit, 5xx) — leave state untouched so the
    // component is retried on the next pass.
    return { slug: component.slug, status: response.status, available: null, version: null };
  }

  const data = await response.json();
  await markSynced(component.id, true);

  if (data.name && typeof data.name === 'string') {
    await db.query('UPDATE components SET title = ? WHERE id = ?', [stripAll(data.name), component.id]);
  }

  // Use the wordpress.org plugin page as the canonical URL
  await db.query('UPDATE components SET url = ? WHERE id = ?', [`${WPORG_PLUGIN_PAGE_BASE}${component.slug}/`, component.id]);

  if (data.sections && typeof data.sections.description === 'string') {
    const description = stripAll(data.sections.description).substring(0, 4096);
    await db.query('UPDATE components SET description = ? WHERE id = ?', [description, component.id]);
  }

  // Capture WordPress.org metadata for security monitoring
  const added = parseWpOrgDate(data.added);
  const lastUpdated = parseWpOrgDateTime(data.last_updated);
  const requiresPhp = data.requires_php || null;
  const tested = data.tested || null;
  await db.query('UPDATE components SET added = ?, last_updated = ?, requires_php = ?, tested = ? WHERE id = ?', [added, lastUpdated, requiresPhp, tested, component.id]);

  // Capture the current release version — the basis of "is there something
  // newer than what my sites are running". Previously discarded.
  //
  // The changelog rides along, but only for the high-priority lane: it is the
  // input to urgency classification (M13), and only the fast lane feeds the
  // fleet manifest. Storing it for the ~1,100 background components would be
  // dead weight in the releases table.
  const wantsChangelog = component.sync_priority_slug === HIGH_PRIORITY;
  const changelog = wantsChangelog && data.sections && typeof data.sections.changelog === 'string' ? data.sections.changelog : null;

  let version = null;
  if (data.version != null && (typeof data.version === 'string' || typeof data.version === 'number')) {
    version = stripAll(String(data.version)).trim() || null;
    if (version) {
      await recordLatestVersion(component.id, version, changelog);
    }
  }

  return { slug: component.slug, status: 200, available: true, version };
}

/**
 * Background low-priority rotation. Runs frequently over a small batch,
 * oldest-synced first. Excludes high-priority (watchlist) components — the
 * hourly high lane owns those — and components already fully synced this
 * cycle (the stale-invalidation cron re-queues them by clearing the flag).
 */
async function syncNextPlugin({ fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();

  try {
    const components = await db.query(
      `SELECT * FROM components
       WHERE component_type_slug = 'wordpress-plugin'
         AND sync_priority_slug != 'high'
         AND synced_from_wporg != 1
       ORDER BY synced_from_wporg_at ASC
       LIMIT ?`,
      [config.batchSize]
    );

    if (!components || components.length === 0) {
      return;
    }

    for (const component of components) {
      try {
        await syncPluginComponent(component, fetch, config);
      } catch (err) {
        console.error(`Error syncing plugin ${component.slug} from wporg:`, err);
      }
    }
  } catch (err) {
    console.error('Error syncing plugin batch from wporg:', err);
  }
}

/**
 * High-priority lane. Re-syncs every watchlist component on each run,
 * regardless of synced_from_wporg, so a fresh release is picked up within
 * the hour. A small inter-request delay keeps the shared wordpress.org API
 * happy across ~20 slugs.
 * @returns {Promise<{synced:number, unavailable:number, transient:number, errors:number}>}
 */
async function syncHighPriorityPlugins({ fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();
  const summary = { synced: 0, unavailable: 0, transient: 0, errors: 0 };

  try {
    const components = await db.query(
      `SELECT * FROM components
       WHERE component_type_slug = 'wordpress-plugin'
         AND sync_priority_slug = 'high'
       ORDER BY slug ASC`
    );

    if (!components || components.length === 0) {
      return summary;
    }

    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      try {
        const result = await syncPluginComponent(component, fetch, config);
        if (result.available === true) {
          summary.synced++;
        } else if (result.available === false) {
          summary.unavailable++;
        } else {
          summary.transient++;
        }
      } catch (err) {
        summary.errors++;
        console.error(`Error syncing high-priority plugin ${component.slug}:`, err);
      }

      if (config.highPriorityDelayMs > 0 && index < components.length - 1) {
        await sleep(config.highPriorityDelayMs);
      }
    }
  } catch (err) {
    console.error('Error syncing high-priority plugin batch from wporg:', err);
  }

  return summary;
}

/**
 * Fetch the current version and changelog for a plugin slug straight from
 * wordpress.org, without reading or writing the database.
 *
 * Used by the CLI so a slug can be classified on demand even when it is not
 * on the watchlist, or not in the database at all. Note that wordpress.org
 * only publishes the changelog for the current release (and for some plugins,
 * such as WooCommerce, literally only the newest entry), so this cannot
 * retrieve the changelog for an arbitrary historical version.
 *
 * @param {string} slug
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<{ok:boolean, reason:string|null, version:string|null, changelog:string|null}>}
 */
async function fetchPluginChangelog(slug, { fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();
  const url = `${config.baseUrl}${config.endpoint}${slug}.json`;

  const response = await fetch(url, {
    timeout: config.timeout,
    headers: { 'User-Agent': config.userAgent },
  });

  if (response.status === 404) {
    return { ok: false, reason: `"${slug}" was not found on wordpress.org.`, version: null, changelog: null };
  }
  if (response.status !== 200) {
    return { ok: false, reason: `wordpress.org returned HTTP ${response.status}.`, version: null, changelog: null };
  }

  const data = await response.json();
  const version = data.version != null ? stripAll(String(data.version)).trim() || null : null;
  const changelog = data.sections && typeof data.sections.changelog === 'string' ? data.sections.changelog : null;

  if (!changelog) {
    return { ok: false, reason: `wordpress.org returned no changelog for "${slug}".`, version, changelog: null };
  }

  return { ok: true, reason: null, version, changelog };
}

module.exports = {
  wporgConfig,
  syncNextPlugin,
  syncHighPriorityPlugins,
  syncPluginComponent,
  probeWpOrgSlug,
  recordLatestVersion,
  fetchPluginChangelog,
  parseWpOrgDate,
  parseWpOrgDateTime,
};
