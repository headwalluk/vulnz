const db = require('../db');
const { stripAll, isUrl } = require('./sanitizer');

async function syncNextPlugin() {
  const fetch = (await import('node-fetch')).default;
  const batchSize = process.env.WPORG_UPDATE_BATCH_SIZE || 1;
  const baseUrl = process.env.WPORG_API_BASE_URL || 'https://api.wordpress.org';
  const endpoint = process.env.WPORG_PLUGIN_INFO_ENDPOINT || '/plugins/info/1.0/';
  const timeout = process.env.WPORG_TIMEOUT_MS || 5000;
  const userAgent = process.env.WPORG_USER_AGENT || 'VULNZ/1.0';
  const wordpressPluginPageUrlBase = 'https://wordpress.org/plugins/';

  try {
    const components = await db.query("SELECT * FROM components WHERE component_type_slug = 'wordpress-plugin' AND synced_from_wporg != 1 LIMIT ?", [parseInt(batchSize, 10)]);

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
          await db.query('UPDATE components SET synced_from_wporg = 1 WHERE id = ?', [component.id]);
        }

        if (response.status === 200) {
          const data = await response.json();
          if (data.name && typeof data.name === 'string') {
            const title = stripAll(data.name);
            await db.query('UPDATE components SET title = ? WHERE id = ?', [title, component.id]);
          }

          // User the wordpress.org plugin page as the canonical URL
          // if (data.homepage && isUrl(data.homepage)) {
          //   await db.query('UPDATE components SET url = ? WHERE id = ?', [data.homepage, component.id]);
          // }
          await db.query('UPDATE components SET url = ? WHERE id = ?', [`${wordpressPluginPageUrlBase}${component.slug}/`, component.id]);

          if (data.sections && typeof data.sections.description === 'string') {
            let description = stripAll(data.sections.description);
            description = description.substring(0, 4096); // Truncate
            await db.query('UPDATE components SET description = ? WHERE id = ?', [description, component.id]);
          }
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
