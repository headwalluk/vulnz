#!/usr/bin/env node
'use strict';

// dotenv must load before any src/ modules touch process.env
require('dotenv').config();

const { Command } = require('commander');
const user = require('../src/models/user');
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

program.parseAsync(process.argv);
