#!/usr/bin/env node
'use strict';

// Run in UTC before anything touches Date or the DB — the mariadb driver
// parses DATETIME columns in the process timezone, but the database stores
// UTC, so a non-UTC process reads stored times off by the local offset. See
// src/index.js for the full rationale. Mandatory for correctness.
process.env.TZ = 'UTC';

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
const { syncWordPressCoreVersion, getWordPressVersionInfo } = require('../src/lib/wpcore');
const { syncHighPriorityPlugins, fetchPluginChangelog, probeWpOrgSlug, reclassifyUnknown, WPORG_STATUS_CLOSED } = require('../src/lib/wporg');
const { formatDateOnly } = require('../src/lib/dates');
const { sanitizeComponentSlug, stripAll, isUrl } = require('../src/lib/sanitizer');
const { classifyRelease, classifyPendingReleases, countPendingReleases, findStoredRelease, saveVerdict } = require('../src/lib/urgency');
const { llmConfig } = require('../src/lib/llm/client');
const { listTasks } = require('../src/lib/llm/tasks');
const { buildWatchlist, getBlindSpots, getStaticWatchlist, addStaticWatchlistEntry, removeStaticWatchlistEntry } = require('../src/lib/watchlist');
const migrations = require('../src/migrations');
const db = require('../src/db');

const program = new Command();

// The only component type wordpress.org exposes a plugin-info endpoint for,
// and therefore the only one the malware commands can safety-check.
const WORDPRESS_PLUGIN_TYPE = 'wordpress-plugin';

// components.malware_summary is VARCHAR(255).
const MALWARE_SUMMARY_MAX_LENGTH = 255;

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
// component:malware:add <type> <slug> [--summary <text>] [--force]
// ---------------------------------------------------------------------------
program
  .command('component:malware:add <type> <slug>')
  .description('Flag a component as known malware (applies to every version)')
  .option('--summary <text>', 'One-line description of what it does, e.g. "Backdoor file dropper"')
  .option('--url <url>', 'Link to a write-up, e.g. https://vulnz.net/malware/wordpress-plugin/easypost/')
  .option('--force', 'Flag it even though the slug is published on wordpress.org')
  .action(async (type, rawSlug, opts) => {
    try {
      const slug = sanitizeComponentSlug(rawSlug);
      const summary = opts.summary ? stripAll(opts.summary).substring(0, MALWARE_SUMMARY_MAX_LENGTH) : null;
      const url = opts.url || null;

      // A broken link in a customer-facing alert costs more trust than no
      // link, so reject a malformed one rather than storing it.
      if (url && !isUrl(url)) {
        process.stderr.write(`Error: "${url}" is not a valid URL.\n`);
        await db.end();
        process.exit(1);
        return;
      }

      // This command creates the component if it does not exist, so an empty
      // slug would leave an unreachable junk row behind.
      if (!slug) {
        process.stderr.write(`Error: "${rawSlug}" is not a usable component slug.\n`);
        await db.end();
        process.exit(1);
        return;
      }

      const componentTypes = await db.query('SELECT slug FROM component_types WHERE slug = ?', [type]);
      if (componentTypes.length === 0) {
        process.stderr.write(`Error: unknown component type "${type}".\n`);
        await db.end();
        process.exit(1);
        return;
      }

      // Fake plugins commonly squat on a real plugin's slug. Flagging one of
      // those would tell the whole fleet that a legitimate plugin is
      // malicious, so check wordpress.org first. The stored wporg_available
      // column is no use here — it is NULL for the overwhelming majority of
      // components — so this is a live lookup.
      if (type === WORDPRESS_PLUGIN_TYPE && !opts.force) {
        let probe;
        try {
          probe = await probeWpOrgSlug(slug);
        } catch (err) {
          probe = { status: 0, available: null, name: null, error: err.message };
        }

        if (probe.available === true) {
          process.stderr.write(`Error: "${slug}" is published on wordpress.org as "${probe.name || slug}".\n`);
          process.stderr.write(`       https://wordpress.org/plugins/${slug}/\n`);
          process.stderr.write('       Flagging it would report a legitimate plugin as malware across the fleet.\n');
          process.stderr.write('       If the wordpress.org listing is itself malicious, re-run with --force.\n');
          await db.end();
          process.exit(1);
          return;
        }

        if (probe.available === null) {
          // Don't block an incident response on a wordpress.org blip.
          console.log(`Warning: could not reach wordpress.org to check "${slug}" (${probe.error || `status ${probe.status}`}). Proceeding.`);
        }

        // A withdrawn plugin is not the false-positive case the guard exists
        // to catch — it is not published, so flagging it cannot tell the
        // fleet a live listing is malicious. Report it anyway: why the
        // directory pulled it is evidence about the decision being made, and
        // "closed for a security issue" is corroboration worth seeing before
        // committing a fleet-wide verdict.
        if (probe.wporgStatus === WPORG_STATUS_CLOSED) {
          console.log(`Note: "${slug}" was published on wordpress.org and has been withdrawn.`);
          console.log(`      Reason: ${probe.closureReason || 'unknown'}${probe.closedAt ? ` (closed ${probe.closedAt})` : ''}`);
          console.log('      Proceeding — a withdrawn plugin can still be flagged.');
        }
      }

      const existing = await component.findByTypeAndSlug(type, slug);
      const target = existing || (await component.findOrCreate(slug, type, slug));
      const componentId = parseInt(target.id, 10);

      if (!existing) {
        console.log(`Created component: ${slug} (id=${componentId}, type=${type})`);
      }

      await component.flagAsMalware(componentId, { summary, url });

      const releases = await db.query('SELECT COUNT(*) AS total FROM releases WHERE component_id = ?', [componentId]);
      const releaseCount = parseInt(releases[0].total, 10);

      console.log(`Flagged as malware: ${type}/${slug} (id=${componentId})`);
      console.log(`Summary: ${summary || '(none)'}`);
      console.log(`URL: ${url || '(none)'}`);
      console.log(`Applies to all ${releaseCount} known release(s), and any ingested later.`);
      if (existing && existing.is_malware) {
        console.log('Note: this component was already flagged — the summary and timestamp have been updated.');
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
// component:malware:remove <type> <slug>
// ---------------------------------------------------------------------------
program
  .command('component:malware:remove <type> <slug>')
  .description('Clear the malware flag from a component')
  .action(async (type, rawSlug) => {
    try {
      const slug = sanitizeComponentSlug(rawSlug);
      const target = await component.findByTypeAndSlug(type, slug);

      if (!target) {
        console.log(`No component found: ${type}/${slug}`);
        await db.end();
        process.exit(0);
        return;
      }

      if (!target.is_malware) {
        console.log(`Not flagged as malware: ${type}/${slug}`);
        await db.end();
        process.exit(0);
        return;
      }

      await component.clearMalwareFlag(parseInt(target.id, 10));
      console.log(`Cleared malware flag: ${type}/${slug} (id=${parseInt(target.id, 10)})`);

      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// component:malware:list [--json]
// ---------------------------------------------------------------------------
program
  .command('component:malware:list')
  .description('List all components flagged as known malware')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const flagged = await component.findMalware();

      if (opts.json) {
        console.log(
          JSON.stringify(
            flagged.map((row) => ({
              ...row,
              id: parseInt(row.id, 10),
              release_count: parseInt(row.release_count, 10),
            })),
            null,
            2
          )
        );
      } else if (flagged.length === 0) {
        console.log('No components are flagged as malware.');
      } else {
        const colWidths = {
          slug: Math.max(4, ...flagged.map((row) => row.slug.length)),
          type: Math.max(4, ...flagged.map((row) => row.component_type_slug.length)),
          summary: Math.max(7, ...flagged.map((row) => (row.malware_summary || '').length)),
        };

        const pad = (str, len) => String(str || '').padEnd(len);
        const header = `${pad('SLUG', colWidths.slug)}  ${pad('TYPE', colWidths.type)}  ${pad('SUMMARY', colWidths.summary)}  RELEASES  FLAGGED`;
        console.log(header);
        console.log('-'.repeat(header.length));

        for (const row of flagged) {
          const flaggedAt = row.malware_flagged_at ? new Date(row.malware_flagged_at).toISOString().substring(0, 19).replace('T', ' ') : '-';
          console.log(
            `${pad(row.slug, colWidths.slug)}  ${pad(row.component_type_slug, colWidths.type)}  ${pad(row.malware_summary || '-', colWidths.summary)}  ${String(row.release_count).padStart(8)}  ${flaggedAt}`
          );
        }

        console.log(`\n${flagged.length} component(s) flagged.`);
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

// ---------------------------------------------------------------------------
// wporg:sync-core [--json]
// ---------------------------------------------------------------------------
program
  .command('wporg:sync-core')
  .description('Sync the current WordPress core version from wordpress.org (stable-check)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const result = await syncWordPressCoreVersion();
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.ok) {
        console.log(`WordPress core version synced: latest=${result.latest} (${result.safeCount} safe versions cached).`);
      } else {
        console.log(`WordPress core version sync did not update settings: ${result.reason}`);
      }
      await db.end();
      process.exit(result.ok ? 0 : 1);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// wporg:sync-high
// ---------------------------------------------------------------------------
program
  .command('wporg:sync-high')
  .description('Sync all high-priority (watchlist) plugins from wordpress.org now')
  .action(async () => {
    try {
      const summary = await syncHighPriorityPlugins();
      console.log(`High-priority sync: ${summary.synced} synced, ${summary.unavailable} unavailable, ${summary.transient} transient, ${summary.errors} error(s).`);
      await db.end();
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// wporg:reclassify [--limit N]
// ---------------------------------------------------------------------------
program
  .command('wporg:reclassify')
  .description('Resolve components whose wordpress.org status is still unknown (closed vs never listed)')
  .option('--limit <n>', 'How many components to check in this run', '50')
  .action(async (opts) => {
    try {
      const limit = parseInt(opts.limit, 10);
      if (Number.isNaN(limit) || limit < 1) {
        process.stderr.write(`Error: --limit must be a positive integer, got "${opts.limit}".\n`);
        await db.end();
        process.exit(1);
        return;
      }

      const [{ remaining }] = await db.query("SELECT COUNT(*) AS remaining FROM components WHERE component_type_slug = 'wordpress-plugin' AND wporg_status_slug = 'unknown'");

      const summary = await reclassifyUnknown({ limit });

      console.log(
        `Reclassified ${summary.checked} component(s): ${summary.available} available, ${summary.closed} closed, ${summary.absent} never listed, ${summary.transient} unresolved, ${summary.errors} error(s).`
      );
      console.log(`Remaining unknown after this run: ${Math.max(0, parseInt(remaining, 10) - summary.checked)}`);

      if (summary.securityClosures.length > 0) {
        console.log('');
        console.log(`${summary.securityClosures.length} plugin(s) closed by wordpress.org for a security issue:`);
        for (const closure of summary.securityClosures) {
          console.log(`  ${closure.slug}${closure.closedAt ? ` (closed ${closure.closedAt})` : ''}`);
        }
        console.log('');
        console.log('Check which sites are running these: vulnz wporg:closed --security-only');
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
// wporg:closed [--security-only] [--json]
// ---------------------------------------------------------------------------
program
  .command('wporg:closed')
  .description('List components withdrawn from wordpress.org, and how many sites still run them')
  .option('--security-only', 'Only closures wordpress.org attributes to a security issue')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const params = [];
      let securityClause = '';
      if (opts.securityOnly) {
        securityClause = 'AND r.is_security_concern = 1';
      }

      const rows = await db.query(
        `SELECT c.slug, c.title, c.wporg_closed_at, c.wporg_closure_reason_slug AS reason,
                r.title AS reason_title, r.is_security_concern,
                COUNT(DISTINCT wc.website_id) AS install_count
         FROM components c
         LEFT JOIN wporg_closure_reasons r ON c.wporg_closure_reason_slug = r.slug
         LEFT JOIN releases rel ON rel.component_id = c.id
         LEFT JOIN website_components wc ON wc.release_id = rel.id
         WHERE c.component_type_slug = 'wordpress-plugin'
           AND c.wporg_status_slug = 'closed'
           ${securityClause}
         GROUP BY c.id, c.slug, c.title, c.wporg_closed_at, c.wporg_closure_reason_slug, r.title, r.is_security_concern
         ORDER BY install_count DESC, c.wporg_closed_at DESC`,
        params
      );

      if (opts.json) {
        console.log(
          JSON.stringify(
            rows.map((row) => ({
              slug: row.slug,
              title: row.title,
              closed_at: formatDateOnly(row.wporg_closed_at),
              reason: row.reason,
              is_security_concern: row.is_security_concern === null ? null : !!row.is_security_concern,
              install_count: parseInt(row.install_count, 10),
            })),
            null,
            2
          )
        );
        await db.end();
        process.exit(0);
        return;
      }

      if (rows.length === 0) {
        console.log('No closed components recorded. Run `vulnz wporg:reclassify` if statuses have not been resolved yet.');
        await db.end();
        process.exit(0);
        return;
      }

      console.log(`${rows.length} component(s) withdrawn from wordpress.org:`);
      console.log('');
      for (const row of rows) {
        const installs = parseInt(row.install_count, 10);
        const security = row.is_security_concern === 1 ? ' [SECURITY]' : '';
        console.log(`  ${row.slug}${security}`);
        const closedAt = formatDateOnly(row.wporg_closed_at);
        console.log(`    Reason: ${row.reason_title || row.reason || 'unknown'}${closedAt ? ` — closed ${closedAt}` : ''}`);
        console.log(`    Sites running it: ${installs}`);
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
// wporg:watchlist [--json]
// ---------------------------------------------------------------------------
program
  .command('wporg:watchlist')
  .description('Show the current high-priority watchlist and blind spots')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const rows = await db.query(
        `SELECT slug, latest_version, latest_version_at
         FROM components
         WHERE component_type_slug = 'wordpress-plugin' AND sync_priority_slug = 'high'
         ORDER BY slug ASC`
      );
      const blindSpots = await getBlindSpots();
      const core = await getWordPressVersionInfo();

      if (opts.json) {
        console.log(JSON.stringify({ wordpress_core: core.latest, plugins: rows, blind_spots: blindSpots }, null, 2));
      } else {
        console.log(`WordPress core latest: ${core.latest || 'unknown'}`);
        console.log(`High-priority plugins (${rows.length}):`);
        for (const row of rows) {
          console.log(`  ${row.slug.padEnd(32)} ${row.latest_version || '(no version yet)'}`);
        }
        console.log(`Blind spots (${blindSpots.length}): ${blindSpots.length ? blindSpots.join(', ') : 'none'}`);
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
// wporg:watchlist:rebuild [--json]
// ---------------------------------------------------------------------------
program
  .command('wporg:watchlist:rebuild')
  .description('Rebuild the high-priority watchlist (static list ∪ top-N by install count)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const result = await buildWatchlist();
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(
          `Watchlist rebuilt: ${result.high.length} high-priority (${result.staticCount} static, ${result.derivedCount} derived), ${result.blindSpots.length} blind spot(s), ${result.probed} probed.`
        );
        if (result.blindSpots.length) {
          console.log(`Blind spots: ${result.blindSpots.join(', ')}`);
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
// wporg:watchlist:static:list [--json]
// ---------------------------------------------------------------------------
program
  .command('wporg:watchlist:static:list')
  .description('List the static "always monitor" watchlist slugs')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const slugs = await getStaticWatchlist();
      if (opts.json) {
        console.log(JSON.stringify(slugs, null, 2));
      } else if (slugs.length === 0) {
        console.log('Static watchlist is empty.');
      } else {
        console.log(`Static watchlist (${slugs.length}):`);
        for (const slug of slugs) {
          console.log(`  ${slug}`);
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
// wporg:watchlist:static:add <slug>
// ---------------------------------------------------------------------------
program
  .command('wporg:watchlist:static:add <slug>')
  .description('Add a plugin slug to the static "always monitor" watchlist')
  .action(async (slug) => {
    try {
      const result = await addStaticWatchlistEntry(slug);
      if (result.added) {
        console.log(`Added "${result.slug}" to the static watchlist (${result.list.length} total).`);
        console.log('Run "vulnz wporg:watchlist:rebuild" to apply the change now.');
      } else {
        console.log(`"${result.slug}" is already on the static watchlist.`);
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
// wporg:watchlist:static:remove <slug>
// ---------------------------------------------------------------------------
program
  .command('wporg:watchlist:static:remove <slug>')
  .description('Remove a plugin slug from the static "always monitor" watchlist')
  .action(async (slug) => {
    try {
      const result = await removeStaticWatchlistEntry(slug);
      if (result.removed) {
        console.log(`Removed "${result.slug}" from the static watchlist (${result.list.length} remaining).`);
        console.log('Run "vulnz wporg:watchlist:rebuild" to apply the change now.');
      } else {
        console.log(`"${result.slug}" is not on the static watchlist.`);
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
// db:migrate [--json]
// ---------------------------------------------------------------------------
program
  .command('db:migrate')
  .description('Apply any pending database migrations without starting the server')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const applied = await migrations.run();

      if (opts.json) {
        console.log(JSON.stringify({ applied, count: applied.length }, null, 2));
      } else if (applied.length === 0) {
        console.log('No pending migrations — the schema is up to date.');
      } else {
        console.log(`Applied ${applied.length} migration(s):`);
        for (const name of applied) {
          console.log(`  ${name}`);
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
// llm:status [--json]
// ---------------------------------------------------------------------------
program
  .command('llm:status')
  .description('Show LLM provider configuration and the classification backlog')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const config = llmConfig();
      const pending = await countPendingReleases();
      const status = {
        enabled: config.enabled,
        api_key_present: config.apiKey !== '',
        base_url: config.baseUrl,
        model: config.model,
        timeout_ms: config.timeoutMs,
        max_attempts: config.maxAttempts,
        pending_classifications: pending,
        tasks: listTasks(),
      };

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Enabled:  ${status.enabled ? 'yes' : 'no'}`);
        console.log(`API key:  ${status.api_key_present ? 'present' : 'MISSING'}`);
        console.log(`Endpoint: ${status.base_url}`);
        console.log(`Model:    ${status.model}`);
        console.log(`Pending:  ${status.pending_classifications} release(s) awaiting classification`);
        console.log('Tasks:');
        for (const task of status.tasks) {
          console.log(`  ${task.slug} — ${task.description}`);
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
// llm:classify-release <slug> <version> [--save] [--json]
// ---------------------------------------------------------------------------
program
  .command('llm:classify-release <slug> <version>')
  .description('Classify a wordpress.org plugin release as urgent or routine')
  .option('--save', 'Persist the verdict against the stored release')
  .option('--json', 'Output as JSON')
  .action(async (slug, version, opts) => {
    try {
      const stored = await findStoredRelease(slug, version);
      let changelog = stored && stored.changelog ? stored.changelog : null;

      // Fall back to wordpress.org when we have no changelog stored. Only the
      // current release's changelog is published, so this can only help for
      // the version that is live right now.
      if (!changelog) {
        const fetched = await fetchPluginChangelog(slug);
        if (!fetched.ok) {
          process.stderr.write(`Error: ${fetched.reason}\n`);
          await db.end();
          process.exit(1);
        }
        if (fetched.version !== version) {
          process.stderr.write(`Error: no changelog stored for ${slug} ${version}, and wordpress.org currently publishes ${fetched.version}.\n`);
          process.stderr.write('wordpress.org only exposes the changelog for the current release.\n');
          await db.end();
          process.exit(1);
        }
        changelog = fetched.changelog;
      }

      const outcome = await classifyRelease({ slug, version, changelog });

      if (!outcome.ok) {
        process.stderr.write(`Error: ${outcome.error}\n`);
        await db.end();
        process.exit(1);
      }

      let saved = false;
      if (opts.save) {
        if (!stored) {
          process.stderr.write(`Error: cannot save — no stored release found for ${slug} ${version}.\n`);
          await db.end();
          process.exit(1);
        }
        await saveVerdict(stored.id, outcome.verdict);
        saved = true;
      }

      const result = {
        slug,
        version,
        is_urgent: outcome.verdict.is_urgent,
        summary: outcome.verdict.summary,
        source: outcome.verdict.source,
        model: outcome.model,
        saved,
      };

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${slug} ${version}`);
        console.log(`  is_urgent: ${result.is_urgent}`);
        console.log(`  summary:   ${result.summary}`);
        console.log(`  source:    ${result.source} (${result.model})`);
        console.log(saved ? '  Saved.' : '  Not saved (dry run — pass --save to persist).');
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
// llm:classify-pending [--limit <n>] [--json]
// ---------------------------------------------------------------------------
program
  .command('llm:classify-pending')
  .description('Classify watchlist releases that have no urgency verdict yet')
  .option('--limit <n>', 'Maximum releases to classify in this run')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    try {
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
      if (opts.limit && (Number.isNaN(limit) || limit < 1)) {
        process.stderr.write('Error: --limit must be a positive integer.\n');
        await db.end();
        process.exit(1);
      }

      const summary = await classifyPendingReleases({ limit });

      if (opts.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else if (summary.skipped) {
        console.log(`Skipped: ${summary.reason}`);
      } else {
        console.log(`Classified ${summary.classified} release(s): ${summary.urgent} urgent, ${summary.failed} failed.`);
      }
      await db.end();
      process.exit(summary.skipped || summary.failed > 0 ? 1 : 0);
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      await db.end();
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
