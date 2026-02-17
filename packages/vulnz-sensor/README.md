# vulnz-sensor

A lightweight CLI tool that reads a Node.js project's `package.json`, resolves the exact installed versions of all dependencies, and reports them to a [Vulnz API](https://github.com/headwalluk/vulnz) instance for vulnerability tracking.

## How it works

1. Reads `package.json` from the current directory (or a specified `--dir`)
2. For each dependency, checks `node_modules/<package>/package.json` for the **exact installed version** (falls back to the version spec if `node_modules` isn't present)
3. Sends a `PUT /api/websites/:domain` request to the Vulnz API with the component list, ecosystem (`npm`), and Node.js platform metadata

## Requirements

- Node.js 18 or later
- A running Vulnz API instance
- A valid API key

## Installation

```bash
# As a dev dependency (recommended — run in CI/CD)
npm install --save-dev vulnz-sensor

# Or install globally
npm install -g vulnz-sensor
```

## Usage

```bash
# Using CLI flags
vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY

# Using environment variables
VULNZ_API_URL=https://vulnz.example.com \
  VULNZ_API_KEY=YOUR_API_KEY \
  VULNZ_DOMAIN=myapp.example.com \
  vulnz-sensor

# Include devDependencies (not sent by default)
vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY \
  --include-dev

# Preview what would be sent (no API call made)
vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY \
  --dry-run

# Scan a different directory
vulnz-sensor myapp.example.com \
  --api-url https://vulnz.example.com \
  --api-key YOUR_API_KEY \
  --dir /path/to/project
```

## Options

| Flag                      | Env var         | Description                                          |
| ------------------------- | --------------- | ---------------------------------------------------- |
| `domain` (positional)     | `VULNZ_DOMAIN`  | Website domain to update                             |
| `-u`, `--api-url <url>`   | `VULNZ_API_URL` | Vulnz API base URL                                   |
| `-k`, `--api-key <key>`   | `VULNZ_API_KEY` | Vulnz API key                                        |
| `-d`, `--domain <domain>` | `VULNZ_DOMAIN`  | Website domain (alternative to positional)           |
| `--dir <path>`            | —               | Directory containing `package.json` (default: `cwd`) |
| `--include-dev`           | —               | Also report `devDependencies`                        |
| `--dry-run`               | —               | Print payload without sending to API                 |
| `-h`, `--help`            | —               | Show help message                                    |

## Using in CI/CD (GitHub Actions example)

```yaml
- name: Report dependencies to Vulnz
  run: npx vulnz-sensor ${{ vars.VULNZ_DOMAIN }}
  env:
    VULNZ_API_URL: ${{ vars.VULNZ_API_URL }}
    VULNZ_API_KEY: ${{ secrets.VULNZ_API_KEY }}
```

## Using as a postinstall script

Add to your `package.json`:

```json
{
  "scripts": {
    "postinstall": "vulnz-sensor myapp.example.com || true"
  }
}
```

> The `|| true` prevents a broken Vulnz API connection from blocking your installs.

## Using the library programmatically

```javascript
const { run } = require('vulnz-sensor');

await run({
  apiUrl: 'https://vulnz.example.com',
  apiKey: 'YOUR_API_KEY',
  domain: 'myapp.example.com',
  dir: '/path/to/project', // default: process.cwd()
  includeDev: false, // default: false
  dryRun: false, // default: false
});
```

## What gets sent

The sensor sends a `PUT` request to `/api/websites/:domain`:

```json
{
  "ecosystem": "npm",
  "platform": {
    "name": "Node.js",
    "version": "20.11.0",
    "packageManager": "npm"
  },
  "components": [
    { "slug": "express", "version": "4.18.2", "type": "npm-package" },
    { "slug": "lodash", "version": "4.17.21", "type": "npm-package" }
  ]
}
```

Exact versions come from `node_modules/<package>/package.json` where available, ensuring Vulnz tracks what's actually installed rather than what the version range in `package.json` allows.

## Zero dependencies

`vulnz-sensor` has no runtime dependencies. It uses only Node.js built-in modules (`fs`, `path`, `https`, `http`, `url`).
