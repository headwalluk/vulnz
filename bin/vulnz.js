#!/usr/bin/env node
'use strict';

// dotenv must load before any src/ modules touch process.env
require('dotenv').config();

const { Command } = require('commander');
const user = require('../src/models/user');
const apiKey = require('../src/models/apiKey');
const feed = require('../src/models/feed');
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

program.parseAsync(process.argv);
