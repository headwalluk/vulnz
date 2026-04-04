#!/usr/bin/env node
'use strict';

// dotenv must load before any src/ modules touch process.env
require('dotenv').config();

// Allow BigInt JSON serialization (same patch as src/index.js)
BigInt.prototype.toJSON = function () {
  return this.toString();
};

const { Command } = require('commander');
const user = require('../src/models/user');
const apiKey = require('../src/models/apiKey');
const feed = require('../src/models/feed');
const component = require('../src/models/component');
const release = require('../src/models/release');
const appSetting = require('../src/models/appSetting');
const userSubscription = require('../src/models/userSubscription');
const notificationSite = require('../src/models/notificationSite');
const notificationQueue = require('../src/models/notificationQueue');
const { processQueue } = require('../src/lib/notificationProcessor');
const db = require('../src/db');

const program = new Command();

program.name('vulnz').description('Vulnz API admin CLI').version(require('../package.json').version);

// ---------------------------------------------------------------------------
// user:add <email> <password> [--admin]
// ---------------------------------------------------------------------------
program
  .command('user:add <email> <password>')
  .description('Create a new user account')
  .option('--admin', 'Grant the administrator role')
  .action(async (email, password, opts) => {
    const roleNames = ['user'];
    if (opts.admin) roleNames.push('administrator');

    try {
      const created = await user.createUser(
        email,
        password,
        roleNames,
        false, // blocked
        1, // max_api_keys
        '', // reporting_weekday
        null, // reporting_email
        null, // last_summary_sent_at
        false, // enable_white_label
        null, // white_label_html
        false // paused
      );
      const roles = created.roles || roleNames;
      console.log(`Created user: ${created.username} (id=${created.id}, roles=${roles.join(',')})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:list [--json]
// ---------------------------------------------------------------------------
program
  .command('user:list')
  .description('List all user accounts')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const users = await user.listAll();

      if (opts.json) {
        console.log(JSON.stringify(users, null, 2));
      } else {
        if (users.length === 0) {
          console.log('No users found.');
        } else {
          const colWidths = {
            id: Math.max(4, ...users.map((u) => String(u.id).length)),
            username: Math.max(8, ...users.map((u) => u.username.length)),
            roles: Math.max(5, ...users.map((u) => u.roles.join(',').length)),
            status: 7,
          };

          const pad = (str, len) => String(str).padEnd(len);
          const header = `${pad('ID', colWidths.id)}  ${pad('USERNAME', colWidths.username)}  ${pad('ROLES', colWidths.roles)}  STATUS`;
          const divider = '-'.repeat(header.length);
          console.log(header);
          console.log(divider);

          for (const u of users) {
            const status = u.blocked ? 'BLOCKED' : u.paused ? 'paused' : 'active';
            console.log(`${pad(u.id, colWidths.id)}  ${pad(u.username, colWidths.username)}  ${pad(u.roles.join(','), colWidths.roles)}  ${status}`);
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:delete <email>
// ---------------------------------------------------------------------------
program
  .command('user:delete <email>')
  .description('Delete a user account')
  .action(async (email) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }
      await user.deleteUser(parseInt(found.id, 10));
      console.log(`Deleted user: ${email} (id=${found.id})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:block <email>
// ---------------------------------------------------------------------------
program
  .command('user:block <email>')
  .description('Block a user account (prevents login)')
  .action(async (email) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }
      await user.updateUser(parseInt(found.id, 10), { blocked: true });
      console.log(`Blocked user: ${email} (id=${found.id})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:unblock <email>
// ---------------------------------------------------------------------------
program
  .command('user:unblock <email>')
  .description('Unblock a user account (re-enables login)')
  .action(async (email) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }
      await user.updateUser(parseInt(found.id, 10), { blocked: false });
      console.log(`Unblocked user: ${email} (id=${found.id})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:reset-password <email> <new-password>
// ---------------------------------------------------------------------------
program
  .command('user:reset-password <email> <new-password>')
  .description('Reset the password for an existing user account')
  .action(async (email, newPassword) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }
      await user.updatePassword(parseInt(found.id, 10), newPassword);
      console.log(`Password reset for user: ${email} (id=${found.id})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// user:info <email> [--json]
// ---------------------------------------------------------------------------
program
  .command('user:info <email>')
  .description('Show full account details for a user')
  .option('--json', 'Output as JSON')
  .action(async (email, opts) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }

      const userId = parseInt(found.id, 10);
      const roles = await user.getRoles(userId);
      const keys = await apiKey.listByUserId(userId);
      const subs = await userSubscription.findByUserId(userId);

      const status = found.blocked ? 'BLOCKED' : found.paused ? 'paused' : 'active';

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              id: userId,
              username: found.username,
              status,
              blocked: Boolean(found.blocked),
              paused: Boolean(found.paused),
              roles,
              max_api_keys: parseInt(found.max_api_keys, 10),
              reporting_email: found.reporting_email || null,
              reporting_weekday: found.reporting_weekday || null,
              enable_white_label: Boolean(found.enable_white_label),
              api_keys: keys.map((k) => ({
                id: parseInt(k.id, 10),
                api_key: k.api_key,
                created_at: k.createdAt,
              })),
              subscriptions: subs.map((s) => ({
                site_url: s.site_url,
                wp_user_id: parseInt(s.wp_user_id, 10),
                subscription_id: s.subscription_id ? parseInt(s.subscription_id, 10) : null,
                effective_state: s.effective_state,
                max_sites: parseInt(s.max_sites, 10),
                perpetual: Boolean(s.perpetual),
              })),
            },
            null,
            2
          )
        );
      } else {
        console.log(`User: ${found.username} (id=${userId})`);
        console.log(`Status: ${status}`);
        console.log(`Roles: ${roles.join(', ')}`);
        console.log(`Max API Keys: ${found.max_api_keys}`);
        console.log(`Reporting Email: ${found.reporting_email || '-'}`);
        console.log(`Reporting Day: ${found.reporting_weekday || '-'}`);
        console.log(`White Label: ${found.enable_white_label ? 'yes' : 'no'}`);
        console.log('');

        if (keys.length === 0) {
          console.log('API Keys: none');
        } else {
          console.log('API Keys:');
          for (const k of keys) {
            const created = k.createdAt instanceof Date ? k.createdAt.toISOString() : String(k.createdAt);
            console.log(`  ${k.api_key}  (created ${created})`);
          }
        }
        console.log('');

        if (subs.length === 0) {
          console.log('Subscriptions: none');
        } else {
          console.log('Subscriptions:');
          for (const s of subs) {
            const perp = s.perpetual ? ' [perpetual]' : '';
            console.log(`  ${s.site_url}  state=${s.effective_state}  max_sites=${s.max_sites}${perp}`);
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// key:list <email> [--json]
// ---------------------------------------------------------------------------
program
  .command('key:list <email>')
  .description('List API keys for a user account')
  .option('--json', 'Output as JSON')
  .action(async (email, opts) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }

      const keys = await apiKey.listByUserId(parseInt(found.id, 10));

      if (opts.json) {
        console.log(JSON.stringify(keys, null, 2));
      } else {
        if (keys.length === 0) {
          console.log(`No API keys found for ${email}.`);
        } else {
          const colWidths = {
            id: Math.max(2, ...keys.map((k) => String(k.id).length)),
            api_key: Math.max(7, ...keys.map((k) => k.api_key.length)),
          };

          const pad = (str, len) => String(str).padEnd(len);
          const header = `${pad('ID', colWidths.id)}  ${pad('API KEY', colWidths.api_key)}  CREATED`;
          const divider = '-'.repeat(header.length + 20);
          console.log(header);
          console.log(divider);

          for (const k of keys) {
            const created = k.createdAt instanceof Date ? k.createdAt.toISOString() : String(k.createdAt);
            console.log(`${pad(k.id, colWidths.id)}  ${pad(k.api_key, colWidths.api_key)}  ${created}`);
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// key:generate <email>
// ---------------------------------------------------------------------------
program
  .command('key:generate <email>')
  .description('Generate a new API key for a user account')
  .action(async (email) => {
    try {
      const found = await user.findUserByUsername(email);
      if (!found) {
        process.stderr.write(`Error: User '${email}' not found.\n`);
        await db.end();
        process.exit(1);
      }

      const newKey = await apiKey.createForUser(parseInt(found.id, 10));
      console.log(`Generated API key for ${email}: ${newKey}`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// key:revoke <key>
// ---------------------------------------------------------------------------
program
  .command('key:revoke <key>')
  .description('Revoke (delete) an API key')
  .action(async (key) => {
    try {
      const found = await apiKey.findByKey(key);
      if (!found) {
        process.stderr.write(`Error: API key not found.\n`);
        await db.end();
        process.exit(1);
        return;
      }

      await apiKey.revokeByKey(key);
      console.log(`Revoked API key: ${key}`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// feed:status
// ---------------------------------------------------------------------------
program
  .command('feed:status')
  .description('Show database statistics and last Wordfence sync timestamp')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const status = await feed.getStatus();

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        const lastSync = status.lastSyncedAt instanceof Date ? status.lastSyncedAt.toISOString() : status.lastSyncedAt || 'never';
        const pad = (str, len) => String(str).padStart(len);
        console.log('Feed Status');
        console.log('-----------');
        console.log(`  Components:       ${pad(status.components, 8)}`);
        console.log(`  Releases:         ${pad(status.releases, 8)}`);
        console.log(`  Vulnerabilities:  ${pad(status.vulnerabilities, 8)}`);
        console.log(`  Last wporg sync:  ${lastSync}`);
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// component:find <slug> [--json]
// ---------------------------------------------------------------------------
program
  .command('component:find <slug>')
  .description('Look up a component by slug')
  .option('--json', 'Output as JSON')
  .action(async (slug, opts) => {
    try {
      const components = await feed.findComponentBySlug(slug);

      if (opts.json) {
        console.log(JSON.stringify(components, null, 2));
      } else {
        if (components.length === 0) {
          console.log(`No component found with slug: ${slug}`);
        } else {
          const colWidths = {
            id: Math.max(2, ...components.map((c) => String(c.id).length)),
            slug: Math.max(4, ...components.map((c) => c.slug.length)),
            type: Math.max(4, ...components.map((c) => c.type.length)),
            title: Math.max(5, ...components.map((c) => (c.title || '').length)),
          };

          const pad = (str, len) => String(str || '').padEnd(len);
          const header = `${pad('ID', colWidths.id)}  ${pad('SLUG', colWidths.slug)}  ${pad('TYPE', colWidths.type)}  ${pad('TITLE', colWidths.title)}  RELEASES  VULNS`;
          const divider = '-'.repeat(header.length);
          console.log(header);
          console.log(divider);

          for (const c of components) {
            const vulns = c.vulnCount > 0 ? String(c.vulnCount) : '-';
            console.log(
              `${pad(c.id, colWidths.id)}  ${pad(c.slug, colWidths.slug)}  ${pad(c.type, colWidths.type)}  ${pad(c.title, colWidths.title)}  ${String(c.releaseCount).padStart(8)}  ${vulns.padStart(5)}`
            );
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// component:add <type> <slug> <versions>
// ---------------------------------------------------------------------------
program
  .command('component:add <type> <slug> <versions>')
  .description('Add a component with one or more releases (comma-separated versions)')
  .option('--title <title>', 'Component title (defaults to slug)')
  .action(async (type, slug, versions, opts) => {
    try {
      const title = opts.title || slug;

      // Check whether the component already exists before findOrCreate
      const existing = await db.query('SELECT id FROM components WHERE slug = ? AND component_type_slug = ?', [slug, type]);
      const comp = await component.findOrCreate(slug, type, title);
      const componentId = parseInt(comp.id, 10);

      if (existing.length === 0) {
        console.log(`Created component: ${slug} (id=${componentId}, type=${type})`);
      } else {
        console.log(`Component already exists: ${slug} (id=${componentId})`);
      }

      const versionList = versions
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      let added = 0;
      let skipped = 0;

      for (const version of versionList) {
        const existingRelease = await db.query('SELECT id FROM releases WHERE component_id = ? AND version = ?', [componentId, version]);
        await release.findOrCreate(componentId, version);
        if (existingRelease.length > 0) {
          skipped++;
        } else {
          added++;
        }
      }

      console.log(`Releases: ${added} added, ${skipped} already existed.`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// release:list <slug> [--json]
// ---------------------------------------------------------------------------
program
  .command('release:list <slug>')
  .description('List known releases for a component slug')
  .option('--json', 'Output as JSON')
  .action(async (slug, opts) => {
    try {
      const releases = await feed.listReleasesBySlug(slug);

      if (opts.json) {
        console.log(JSON.stringify(releases, null, 2));
      } else {
        if (releases.length === 0) {
          console.log(`No releases found for component: ${slug}`);
        } else {
          const { title, type } = releases[0];
          console.log(`Component: ${slug} (${title}) — ${type}`);
          console.log('');

          const colWidths = {
            version: Math.max(7, ...releases.map((r) => r.version.length)),
          };

          const pad = (str, len) => String(str).padEnd(len);
          const header = `${pad('VERSION', colWidths.version)}  VULNS`;
          const divider = '-'.repeat(header.length);
          console.log(header);
          console.log(divider);

          for (const r of releases) {
            const vulns = r.vulnCount > 0 ? String(r.vulnCount) : '-';
            console.log(`${pad(r.version, colWidths.version)}  ${vulns}`);
          }

          console.log('');
          console.log(`${releases.length} release(s) listed.`);
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// setting:get <key>
// ---------------------------------------------------------------------------
program
  .command('setting:get <key>')
  .description('Get an app setting value')
  .option('--json', 'Output as JSON')
  .action(async (key, opts) => {
    try {
      const value = await appSetting.get(key);
      if (value === null) {
        process.stderr.write(`Error: Setting '${key}' not found.\n`);
        await db.end();
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ key, value }));
      } else {
        console.log(value);
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// setting:set <key> <value> [--type <type>] [--description <desc>] [--category <cat>]
// ---------------------------------------------------------------------------
program
  .command('setting:set <key> <value>')
  .description('Set an app setting value')
  .option('--type <type>', 'Value type: string, integer, float, boolean', 'string')
  .option('--description <desc>', 'Human-readable description')
  .option('--category <cat>', 'Category for grouping')
  .action(async (key, value, opts) => {
    try {
      await appSetting.set(key, value, opts.type, opts.description || null, opts.category || null);
      const stored = await appSetting.get(key);
      console.log(`${key} = ${stored}`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// setting:list [--category <cat>] [--json]
// ---------------------------------------------------------------------------
program
  .command('setting:list')
  .description('List app settings')
  .option('--category <cat>', 'Filter by category')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const settings = await appSetting.getAll(opts.category || null);

      if (opts.json) {
        console.log(JSON.stringify(settings, null, 2));
      } else {
        if (settings.length === 0) {
          console.log('No settings found.');
        } else {
          const colWidths = {
            key: Math.max(3, ...settings.map((s) => s.key.length)),
            value: Math.max(5, ...settings.map((s) => String(s.value).length)),
            type: Math.max(4, ...settings.map((s) => s.type.length)),
            category: Math.max(8, ...settings.map((s) => (s.category || '').length)),
          };

          const pad = (str, len) => String(str || '').padEnd(len);
          const header = `${pad('KEY', colWidths.key)}  ${pad('VALUE', colWidths.value)}  ${pad('TYPE', colWidths.type)}  CATEGORY`;
          const divider = '-'.repeat(header.length + 5);
          console.log(header);
          console.log(divider);

          for (const s of settings) {
            console.log(`${pad(s.key, colWidths.key)}  ${pad(s.value, colWidths.value)}  ${pad(s.type, colWidths.type)}  ${s.category || '-'}`);
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// site:add <url> <data-secret> [--ip-allowlist <ips>]
// ---------------------------------------------------------------------------
program
  .command('site:add <url> <data-secret>')
  .description('Register a WordPress/WooCommerce notification site')
  .option('--ip-allowlist <ips>', 'Comma-separated IP allowlist')
  .action(async (url, dataSecret, opts) => {
    try {
      const existing = await notificationSite.findByUrl(url);
      if (existing) {
        process.stderr.write(`Error: Site '${url}' is already registered (id=${existing.id}).\n`);
        await db.end();
        process.exit(1);
      }

      const site = await notificationSite.create(url, dataSecret, opts.ipAllowlist || null);
      console.log(`Registered site: ${url} (id=${parseInt(site.id, 10)})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// site:list [--json]
// ---------------------------------------------------------------------------
program
  .command('site:list')
  .description('List registered notification sites')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const sites = await notificationSite.findAll();

      if (opts.json) {
        console.log(JSON.stringify(sites, null, 2));
      } else {
        if (sites.length === 0) {
          console.log('No notification sites registered.');
        } else {
          const colWidths = {
            id: Math.max(2, ...sites.map((s) => String(s.id).length)),
            site_url: Math.max(8, ...sites.map((s) => s.site_url.length)),
            active: 6,
          };

          const pad = (str, len) => String(str).padEnd(len);
          const header = `${pad('ID', colWidths.id)}  ${pad('SITE URL', colWidths.site_url)}  ${pad('ACTIVE', colWidths.active)}  IP ALLOWLIST`;
          const divider = '-'.repeat(header.length + 10);
          console.log(header);
          console.log(divider);

          for (const s of sites) {
            const active = s.active ? 'yes' : 'no';
            const ips = s.ip_allowlist || '-';
            console.log(`${pad(s.id, colWidths.id)}  ${pad(s.site_url, colWidths.site_url)}  ${pad(active, colWidths.active)}  ${ips}`);
          }
        }
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// site:remove <url>
// ---------------------------------------------------------------------------
program
  .command('site:remove <url>')
  .description('Remove a registered notification site')
  .action(async (url) => {
    try {
      const site = await notificationSite.findByUrl(url);
      if (!site) {
        process.stderr.write(`Error: Site '${url}' not found.\n`);
        await db.end();
        process.exit(1);
      }

      await notificationSite.remove(parseInt(site.id, 10));
      console.log(`Removed site: ${url} (id=${site.id})`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// queue:status [--json]
// ---------------------------------------------------------------------------
program
  .command('queue:status')
  .description('Show notification queue status')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const status = await notificationQueue.getStatus();

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log('Notification Queue');
        console.log('------------------');
        console.log(`  Pending:     ${String(status.pending).padStart(6)}`);
        console.log(`  Processing:  ${String(status.processing).padStart(6)}`);
        console.log(`  Completed:   ${String(status.completed).padStart(6)}`);
        console.log(`  Failed:      ${String(status.failed).padStart(6)}`);
      }

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// queue:process [--batch-size <n>]
// ---------------------------------------------------------------------------
program
  .command('queue:process')
  .description('Process pending notifications from the queue')
  .option('--batch-size <n>', 'Number of notifications to process', '10')
  .action(async (opts) => {
    try {
      const batchSize = parseInt(opts.batchSize, 10) || 10;
      const processed = await processQueue(batchSize);
      console.log(`Processed ${processed} notification(s).`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
