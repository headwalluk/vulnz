const db = require('../db');
// const { stripAll, isUrl } = require('./sanitizer');
const { stripAll } = require('./sanitizer');

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

async function syncNextPlugin() {
  const fetch = (await import('node-fetch')).default;
  const batchSize = process.env.WPORG_UPDATE_BATCH_SIZE || 1;
  const baseUrl = process.env.WPORG_API_BASE_URL || 'https://api.wordpress.org';
  const endpoint = process.env.WPORG_PLUGIN_INFO_ENDPOINT || '/plugins/info/1.0/';
  const timeout = process.env.WPORG_TIMEOUT_MS || 5000;
  const userAgent = process.env.WPORG_USER_AGENT || 'VULNZ/1.0';
  const wordpressPluginPageUrlBase = 'https://wordpress.org/plugins/';

  try {
    // Sync plugins that need updating, prioritizing oldest synced_from_wporg_at
    // NULL synced_from_wporg_at sorts first (never synced), then oldest dates
    const components = await db.query(
      "SELECT * FROM components WHERE component_type_slug = 'wordpress-plugin' AND synced_from_wporg != 1 ORDER BY synced_from_wporg_at ASC LIMIT ?",
      [parseInt(batchSize, 10)]
    );

    if (!components || components.length === 0) {
      return;
    }

    for (const component of components) {
      if (process.env.LOG_LEVEL === 'info') {
        console.log(`Syncing plugin: ${component.slug}`);
      }

      try {
        const url = `${baseUrl}${endpoint}${component.slug}.json`;
        const options = {
          timeout: parseInt(timeout, 10),
          headers: {
            'User-Agent': userAgent,
          },
        };
        const response = await fetch(url, options);

        if (process.env.LOG_LEVEL === 'info') {
          if (response.status === 200) {
            console.log(`Syncing ${component.slug}: Found`);
          } else if (response.status === 404) {
            console.log(`Syncing ${component.slug}: Not Found`);
          }
        }

        if (response.status === 200 || response.status === 404) {
          await db.query('UPDATE components SET synced_from_wporg = 1, synced_from_wporg_at = NOW() WHERE id = ?', [component.id]);
        }

        if (response.status === 200) {
          const data = await response.json();
          if (data.name && typeof data.name === 'string') {
            const title = stripAll(data.name);
            await db.query('UPDATE components SET title = ? WHERE id = ?', [title, component.id]);
          }

          // Use the wordpress.org plugin page as the canonical URL
          // if (data.homepage && isUrl(data.homepage)) {
          //   await db.query('UPDATE components SET url = ? WHERE id = ?', [data.homepage, component.id]);
          // }
          await db.query('UPDATE components SET url = ? WHERE id = ?', [`${wordpressPluginPageUrlBase}${component.slug}/`, component.id]);

          if (data.sections && typeof data.sections.description === 'string') {
            let description = stripAll(data.sections.description);
            description = description.substring(0, 4096); // Truncate
            await db.query('UPDATE components SET description = ? WHERE id = ?', [description, component.id]);
          }

          // Capture WordPress.org metadata for security monitoring
          const added = parseWpOrgDate(data.added);
          const lastUpdated = parseWpOrgDateTime(data.last_updated);
          const requiresPhp = data.requires_php || null;
          const tested = data.tested || null;

          await db.query('UPDATE components SET added = ?, last_updated = ?, requires_php = ?, tested = ? WHERE id = ?', [added, lastUpdated, requiresPhp, tested, component.id]);
        }
      } catch (err) {
        console.error(`Error syncing plugin ${component.slug} from wporg:`, err);
      }
    }
  } catch (err) {
    console.error('Error syncing plugin batch from wporg:', err);
  }
}

module.exports = {
  syncNextPlugin,
};
