'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

/**
 * Read package.json from a given directory.
 * @param {string} dir - Directory containing package.json
 * @returns {object} Parsed package.json
 */
function readPackageJson(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  const raw = fs.readFileSync(pkgPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Resolve the exact installed version of a package from node_modules.
 * Falls back to the version spec in package.json (with range prefix stripped).
 * @param {string} dir - Root directory (where node_modules lives)
 * @param {string} name - Package name
 * @param {string} specVersion - Version from package.json (may include ^, ~, *)
 * @returns {string} Best-effort exact version string
 */
function resolveInstalledVersion(dir, name, specVersion) {
  try {
    const installedPkgPath = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(installedPkgPath)) {
      const installed = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
      if (installed.version) {
        return installed.version;
      }
    }
  } catch {
    // Swallow — fall through to specVersion
  }
  // Strip common range prefixes so the API gets a semver-like string
  return specVersion.replace(/^[\^~>=<*]+/, '').trim() || specVersion;
}

/**
 * Build the components array from a package.json object.
 * By default only includes `dependencies`. Pass includeDev=true to also
 * include `devDependencies`.
 *
 * @param {object} pkgJson - Parsed package.json
 * @param {string} dir - Root directory (for node_modules lookup)
 * @param {object} options
 * @param {boolean} [options.includeDev=false] - Include devDependencies
 * @returns {Array<{slug: string, version: string, type: string}>}
 */
function buildComponents(pkgJson, dir, options = {}) {
  const { includeDev = false } = options;
  const components = [];

  const deps = pkgJson.dependencies || {};
  for (const [name, specVersion] of Object.entries(deps)) {
    components.push({
      slug: name,
      version: resolveInstalledVersion(dir, name, specVersion),
      type: 'npm-package',
    });
  }

  if (includeDev) {
    const devDeps = pkgJson.devDependencies || {};
    for (const [name, specVersion] of Object.entries(devDeps)) {
      // Avoid duplicates (package listed in both deps and devDeps)
      const already = components.some((c) => c.slug === name);
      if (!already) {
        components.push({
          slug: name,
          version: resolveInstalledVersion(dir, name, specVersion),
          type: 'npm-package',
        });
      }
    }
  }

  return components;
}

/**
 * Build the platform metadata object from the current runtime.
 * @returns {object}
 */
function buildPlatformMetadata() {
  return {
    name: 'Node.js',
    version: process.version.replace(/^v/, ''),
    packageManager: 'npm',
  };
}

/**
 * Send a PUT request to the Vulnz API to update a website's npm components.
 *
 * @param {object} options
 * @param {string} options.apiUrl      - Base URL of the Vulnz API (e.g. https://vulnz.example.com)
 * @param {string} options.apiKey      - API key
 * @param {string} options.domain      - Website domain to update
 * @param {Array}  options.components  - Components array (from buildComponents)
 * @param {object} [options.platform]  - Platform metadata (from buildPlatformMetadata)
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function sendToApi({ apiUrl, apiKey, domain, components, platform }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      ecosystem: 'npm',
      platform: platform || buildPlatformMetadata(),
      components,
    });

    const parsedUrl = new url.URL(`/api/websites/${encodeURIComponent(domain)}`, apiUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-API-Key': apiKey,
      },
    };

    const req = transport.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Run the sensor: read package.json, build component list, send to API.
 *
 * @param {object} options
 * @param {string} options.apiUrl    - Vulnz API base URL
 * @param {string} options.apiKey    - Vulnz API key
 * @param {string} options.domain    - Website domain to update
 * @param {string} [options.dir]     - Directory containing package.json (default: cwd)
 * @param {boolean} [options.includeDev] - Also send devDependencies
 * @param {boolean} [options.dryRun] - Print payload without sending
 * @returns {Promise<void>}
 */
async function run(options) {
  const { apiUrl, apiKey, domain, dir = process.cwd(), includeDev = false, dryRun = false } = options;

  if (!apiUrl) throw new Error('apiUrl is required');
  if (!apiKey) throw new Error('apiKey is required');
  if (!domain) throw new Error('domain is required');

  const pkgJson = readPackageJson(dir);
  const components = buildComponents(pkgJson, dir, { includeDev });
  const platform = buildPlatformMetadata();

  if (dryRun) {
    console.log('DRY RUN — would send:');
    console.log(JSON.stringify({ ecosystem: 'npm', platform, components }, null, 2));
    return;
  }

  const result = await sendToApi({ apiUrl, apiKey, domain, components, platform });

  if (result.statusCode === 200 || result.statusCode === 204) {
    return result;
  }

  throw new Error(`API returned ${result.statusCode}: ${result.body}`);
}

module.exports = { run, readPackageJson, buildComponents, buildPlatformMetadata, sendToApi, resolveInstalledVersion };
