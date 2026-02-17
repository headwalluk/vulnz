#!/usr/bin/env node
'use strict';

const path = require('path');
const { run } = require('../src/index');

// ---------------------------------------------------------------------------
// CLI argument parsing (manual — no commander dependency)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    apiUrl: null,
    apiKey: null,
    domain: null,
    dir: null,
    includeDev: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--api-url':
      case '-u':
        opts.apiUrl = args[++i];
        break;
      case '--api-key':
      case '-k':
        opts.apiKey = args[++i];
        break;
      case '--domain':
      case '-d':
        opts.domain = args[++i];
        break;
      case '--dir':
        opts.dir = args[++i];
        break;
      case '--include-dev':
        opts.includeDev = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        // First positional argument is treated as domain
        if (!arg.startsWith('-') && !opts.domain) {
          opts.domain = arg;
        }
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
vulnz-sensor — Reports npm dependencies to a Vulnz API instance

Usage:
  vulnz-sensor [domain] [options]

Arguments:
  domain                  Website domain to update (e.g. myapp.example.com)

Options:
  -u, --api-url <url>     Vulnz API base URL (env: VULNZ_API_URL)
  -k, --api-key <key>     Vulnz API key      (env: VULNZ_API_KEY)
  -d, --domain <domain>   Website domain     (env: VULNZ_DOMAIN)
      --dir <path>        Directory containing package.json (default: cwd)
      --include-dev       Also report devDependencies
      --dry-run           Print payload without sending to the API
  -h, --help              Show this help message

Environment variables:
  VULNZ_API_URL           Vulnz API base URL
  VULNZ_API_KEY           Vulnz API key
  VULNZ_DOMAIN            Website domain

Examples:
  # Using CLI flags
  vulnz-sensor myapp.example.com --api-url https://vulnz.example.com --api-key mykey

  # Using environment variables
  VULNZ_API_URL=https://vulnz.example.com VULNZ_API_KEY=mykey VULNZ_DOMAIN=myapp.example.com vulnz-sensor

  # Preview what would be sent (no API call)
  vulnz-sensor myapp.example.com --api-url https://vulnz.example.com --api-key mykey --dry-run

  # Include dev dependencies and run from a specific directory
  vulnz-sensor myapp.example.com --api-url https://vulnz.example.com --api-key mykey --dir /path/to/project --include-dev
`);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Resolve values: CLI flags > environment variables
  const apiUrl = opts.apiUrl || process.env.VULNZ_API_URL || null;
  const apiKey = opts.apiKey || process.env.VULNZ_API_KEY || null;
  const domain = opts.domain || process.env.VULNZ_DOMAIN || null;
  const dir = opts.dir ? path.resolve(opts.dir) : process.cwd();
  const { includeDev, dryRun } = opts;

  const missing = [];
  if (!apiUrl) missing.push('--api-url / VULNZ_API_URL');
  if (!apiKey) missing.push('--api-key / VULNZ_API_KEY');
  if (!domain) missing.push('domain argument / VULNZ_DOMAIN');

  if (missing.length > 0) {
    console.error(`Error: missing required values:\n  ${missing.join('\n  ')}`);
    console.error('\nRun with --help for usage information.');
    process.exit(1);
  }

  try {
    console.log(`vulnz-sensor: scanning ${dir}`);
    console.log(`vulnz-sensor: reporting to ${apiUrl} for domain ${domain}`);

    await run({ apiUrl, apiKey, domain, dir, includeDev, dryRun });

    if (!dryRun) {
      console.log('vulnz-sensor: ✓ components reported successfully');
    }

    process.exit(0);
  } catch (err) {
    console.error(`vulnz-sensor: error — ${err.message}`);
    process.exit(1);
  }
}

main();
