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

const WPORG_STATUS_AVAILABLE = 'available';
const WPORG_STATUS_CLOSED = 'closed';
const WPORG_STATUS_ABSENT = 'absent';
const WPORG_STATUS_UNKNOWN = 'unknown';

const UNKNOWN_CLOSURE_REASON = 'unknown';

/**
 * Read the JSON body of a wordpress.org 404 and work out which kind it is.
 *
 * The directory returns 404 both for a slug it has never heard of and for a
 * plugin it has withdrawn, and only the body tells them apart:
 *
 *   {"error":"Plugin not found."}
 *   {"error":"closed", "closed":true, "closed_date":"2024-10-17",
 *    "reason":"security-issue", "reason_text":"Security Issue", "name":"..."}
 *
 * A body that will not parse is treated as absent rather than throwing: the
 * caller is in the middle of a batch sync and an unreadable body is not worth
 * losing the rest of the run over.
 *
 * `description` is deliberately ignored. On a closed plugin it is the
 * directory's closure notice ("This plugin has been closed as of ...") and
 * not a description of the plugin, so writing it to components.description
 * would fill the field with boilerplate — and overwrite anything curated by
 * hand for exactly the components most likely to have been.
 *
 * @returns {Promise<{status: string, closureReason: string|null, closedAt: string|null, name: string|null}>}
 */
async function readNotFoundBody(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    return { status: WPORG_STATUS_ABSENT, closureReason: null, closedAt: null, name: null };
  }

  if (!data || typeof data !== 'object' || (data.error !== WPORG_STATUS_CLOSED && data.closed !== true)) {
    return { status: WPORG_STATUS_ABSENT, closureReason: null, closedAt: null, name: null };
  }

  return {
    status: WPORG_STATUS_CLOSED,
    closureReason: typeof data.reason === 'string' && data.reason.trim() !== '' ? stripAll(data.reason).trim() : UNKNOWN_CLOSURE_REASON,
    closedAt: parseWpOrgDate(data.closed_date),
    name: typeof data.name === 'string' && data.name.trim() !== '' ? stripAll(data.name) : null,
  };
}

/**
 * Resolve a closure reason to a row in wporg_closure_reasons.
 *
 * An unrecognised reason is inserted rather than dropped or coerced to
 * `unknown`: wordpress.org owns this vocabulary and can extend it whenever it
 * likes, and losing the actual reason would be worse than carrying a row
 * nobody has classified yet. `is_security_concern` stays NULL on those — the
 * honest answer to "is this a security concern" when nobody has looked — and
 * the warning is the prompt to classify it.
 *
 * @returns {Promise<string>} the reason slug to store
 */
async function resolveClosureReason(reason) {
  if (!reason) {
    return UNKNOWN_CLOSURE_REASON;
  }

  const known = await db.query('SELECT slug FROM wporg_closure_reasons WHERE slug = ?', [reason]);
  if (Array.isArray(known) && known.length > 0) {
    return reason;
  }

  console.warn(`wordpress.org returned an unrecognised closure reason "${reason}". Recording it with is_security_concern unset — classify it in wporg_closure_reasons.`);
  await db.query('INSERT IGNORE INTO wporg_closure_reasons (slug, title, is_security_concern) VALUES (?, ?, NULL)', [reason, reason]);
  return reason;
}

/**
 * Mark a component as synced from wordpress.org, recording what was found.
 *
 * `wporg_available` is still written so that `src/lib/watchlist.js` keeps
 * working unchanged; `wporg_status_slug` is the finer-grained replacement and
 * separates a withdrawn plugin from one that was never listed.
 *
 * @param {number} componentId
 * @param {string} status one of the WPORG_STATUS_* values
 * @param {{closureReason?: string|null, closedAt?: string|null}} [closure]
 */
async function markSynced(componentId, status, closure = {}) {
  const isAvailable = status === WPORG_STATUS_AVAILABLE;
  const reasonSlug = status === WPORG_STATUS_CLOSED ? await resolveClosureReason(closure.closureReason) : null;
  const closedAt = status === WPORG_STATUS_CLOSED ? closure.closedAt || null : null;

  await db.query(
    `UPDATE components
     SET synced_from_wporg = 1,
         synced_from_wporg_at = CURRENT_TIMESTAMP,
         wporg_available = ?,
         wporg_status_slug = ?,
         wporg_closure_reason_slug = ?,
         wporg_closed_at = ?
     WHERE id = ?`,
    [isAvailable ? 1 : 0, status, reasonSlug, closedAt, componentId]
  );
}

/**
 * Adopt the real plugin name from a closure record, but only when the
 * component has no better title of its own.
 *
 * Components are auto-created with `title = slug`, so a withdrawn plugin
 * usually reads back as `portable-phpmyadmin` rather than "Portable
 * phpMyAdmin". The closure body carries the genuine name and is worth taking
 * — but never over a title someone has curated, which for off-directory
 * components is precisely the point of being able to curate them.
 */
async function adoptClosedName(component, name) {
  if (!name || component.title !== component.slug) {
    return;
  }
  await db.query('UPDATE components SET title = ? WHERE id = ?', [name, component.id]);
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
 * A withdrawn plugin reports `available: false` with `wporgStatus: 'closed'`.
 * Both parts matter to the caller: it is not currently published, so flagging
 * it is not the fleet-wide mistake the guard exists to prevent — but it was a
 * real listing once, and *why* it was pulled is evidence about the flag being
 * considered rather than a reason to block it.
 *
 * @param {string} slug
 * @returns {Promise<{status:number, available:boolean|null, wporgStatus:string, name:string|null, closureReason:string|null, closedAt:string|null}>}
 *   available is true (published), false (absent or closed), or null
 *   (couldn't tell — a timeout, rate limit, or 5xx).
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
    const closure = await readNotFoundBody(response);
    return {
      status: 404,
      available: false,
      wporgStatus: closure.status,
      name: closure.name,
      closureReason: closure.closureReason,
      closedAt: closure.closedAt,
    };
  }

  if (response.status !== 200) {
    return { status: response.status, available: null, wporgStatus: WPORG_STATUS_UNKNOWN, name: null, closureReason: null, closedAt: null };
  }

  const data = await response.json();

  // wordpress.org sometimes answers 200 with an error body rather than 404.
  // Treating that as "published" would block a genuine malware flag, so it
  // is read as absent.
  if (!data || data.error) {
    return { status: 200, available: false, wporgStatus: WPORG_STATUS_ABSENT, name: null, closureReason: null, closedAt: null };
  }

  return {
    status: 200,
    available: true,
    wporgStatus: WPORG_STATUS_AVAILABLE,
    name: typeof data.name === 'string' ? stripAll(data.name) : null,
    closureReason: null,
    closedAt: null,
  };
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
    const closure = await readNotFoundBody(response);
    await markSynced(component.id, closure.status, closure);
    if (closure.status === WPORG_STATUS_CLOSED) {
      await adoptClosedName(component, closure.name);
    }
    return {
      slug: component.slug,
      status: 404,
      available: false,
      wporgStatus: closure.status,
      closureReason: closure.closureReason,
      closedAt: closure.closedAt,
      version: null,
    };
  }

  if (response.status !== 200) {
    // Transient error (rate limit, 5xx) — leave state untouched so the
    // component is retried on the next pass.
    return { slug: component.slug, status: response.status, available: null, wporgStatus: WPORG_STATUS_UNKNOWN, version: null };
  }

  const data = await response.json();
  await markSynced(component.id, WPORG_STATUS_AVAILABLE);

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

  return { slug: component.slug, status: 200, available: true, wporgStatus: WPORG_STATUS_AVAILABLE, version };
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

/**
 * Resolve components whose wordpress.org status is still `unknown`.
 *
 * The M17.7 migration cannot tell a pre-existing `wporg_available = 0` apart
 * from a closure — the reason was never recorded — so every one of them
 * starts as `unknown`. The background rotation would eventually re-check them
 * via the stale-invalidation cron, but at WPORG_UPDATE_BATCH_SIZE per run
 * that is measured in weeks, and the whole point of the change is a security
 * signal nobody wants to wait weeks for. This is the deliberate pass.
 *
 * Ordered oldest-synced first so repeated runs work through the backlog
 * rather than re-checking the same head of the queue.
 *
 * @param {{limit?: number, fetchImpl?: Function}} [options]
 * @returns {Promise<{checked:number, available:number, closed:number, absent:number, transient:number, errors:number, securityClosures:Array<{slug:string, reason:string, closedAt:string|null}>}>}
 */
async function reclassifyUnknown({ limit = 50, fetchImpl } = {}) {
  const fetch = fetchImpl || (await import('node-fetch')).default;
  const config = wporgConfig();
  const summary = { checked: 0, available: 0, closed: 0, absent: 0, transient: 0, errors: 0, securityClosures: [] };

  const components = await db.query(
    `SELECT * FROM components
     WHERE component_type_slug = 'wordpress-plugin'
       AND wporg_status_slug = ?
     ORDER BY synced_from_wporg_at IS NULL, synced_from_wporg_at ASC
     LIMIT ?`,
    [WPORG_STATUS_UNKNOWN, limit]
  );

  if (!Array.isArray(components) || components.length === 0) {
    return summary;
  }

  const securityReasons = await db.query('SELECT slug FROM wporg_closure_reasons WHERE is_security_concern = 1');
  const securitySlugs = new Set((securityReasons || []).map((row) => row.slug));

  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    try {
      const result = await syncPluginComponent(component, fetch, config);
      summary.checked++;

      if (result.wporgStatus === WPORG_STATUS_AVAILABLE) {
        summary.available++;
      } else if (result.wporgStatus === WPORG_STATUS_CLOSED) {
        summary.closed++;
        if (securitySlugs.has(result.closureReason)) {
          summary.securityClosures.push({ slug: component.slug, reason: result.closureReason, closedAt: result.closedAt });
        }
      } else if (result.wporgStatus === WPORG_STATUS_ABSENT) {
        summary.absent++;
      } else {
        summary.transient++;
      }
    } catch (err) {
      summary.errors++;
      console.error(`Error reclassifying plugin ${component.slug}:`, err);
    }

    // Same courtesy delay the high-priority lane uses — this walks a long
    // backlog against a shared public API.
    if (index < components.length - 1 && config.highPriorityDelayMs > 0) {
      await sleep(config.highPriorityDelayMs);
    }
  }

  return summary;
}

module.exports = {
  wporgConfig,
  syncNextPlugin,
  syncHighPriorityPlugins,
  syncPluginComponent,
  probeWpOrgSlug,
  reclassifyUnknown,
  recordLatestVersion,
  fetchPluginChangelog,
  parseWpOrgDate,
  parseWpOrgDateTime,
  WPORG_STATUS_AVAILABLE,
  WPORG_STATUS_CLOSED,
  WPORG_STATUS_ABSENT,
  WPORG_STATUS_UNKNOWN,
};
