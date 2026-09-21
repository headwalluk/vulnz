/**
 * wordpress.org request timeouts
 *
 * Every wordpress.org request must give up after WPORG_TIMEOUT_MS. node-fetch v3
 * ignored the `timeout` option, so a stalled connection could hang a sync
 * indefinitely. These tests run against a real local server that accepts
 * connections and then stalls, either before the headers or partway through
 * the body.
 */

const http = require('http');
const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const wporg = require('../../src/lib/wporg');
const { syncWordPressCoreVersion } = require('../../src/lib/wpcore');

const ENV_TIMEOUT_MS = 1000;
const DIRECT_TIMEOUT_MS = 200;
// Generous ceiling: proves the request was cut off, not that the timer is precise.
const TIMEOUT_CEILING_FACTOR = 4;

let db;
let server;
let baseUrl;
const openSockets = new Set();
const savedEnv = {};

/** Time an async call, returning its outcome and elapsed milliseconds. */
async function timed(operation) {
  const startedAt = Date.now();
  let outcome;
  try {
    outcome = { value: await operation() };
  } catch (err) {
    outcome = { error: err };
  }
  return { ...outcome, elapsedMs: Date.now() - startedAt };
}

function directConfig() {
  return { baseUrl, endpoint: '/plugins/info/1.0/', timeout: DIRECT_TIMEOUT_MS, userAgent: 'VULNZ-test' };
}

beforeAll(async () => {
  db = await createTestDatabase();
  mockDb.query.mockImplementation((...args) => db.query(...args));
  await initializeSchema(db);

  server = http.createServer((req, res) => {
    if (req.url.includes('stalled-body')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"name": "Half a resp');
    }
    // Otherwise never respond at all.
  });
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const name of ['WPORG_API_BASE_URL', 'WPORG_TIMEOUT_MS', 'WPORG_HIGH_PRIORITY_DELAY_MS']) {
    savedEnv[name] = process.env[name];
  }
  process.env.WPORG_API_BASE_URL = baseUrl;
  process.env.WPORG_TIMEOUT_MS = String(ENV_TIMEOUT_MS);
  process.env.WPORG_HIGH_PRIORITY_DELAY_MS = '0';
});

afterAll(async () => {
  for (const socket of openSockets) {
    socket.destroy();
  }
  await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  await cleanupTestDatabase(db);
});

describe('wordpress.org request timeouts', () => {
  test('syncPluginComponent gives up when no response arrives', async () => {
    const result = await timed(() => wporg.syncPluginComponent({ id: 1, slug: 'silent-plugin' }, globalThis.fetch, directConfig()));

    expect(result.error).toBeDefined();
    expect(result.error.name).toBe('TimeoutError');
    expect(result.elapsedMs).toBeLessThan(DIRECT_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });

  test('syncPluginComponent gives up when the body stalls after the headers', async () => {
    const result = await timed(() => wporg.syncPluginComponent({ id: 1, slug: 'stalled-body' }, globalThis.fetch, directConfig()));

    expect(result.error).toBeDefined();
    expect(result.error.name).toBe('TimeoutError');
    expect(result.elapsedMs).toBeLessThan(DIRECT_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });

  test('probeWpOrgSlug honours WPORG_TIMEOUT_MS', async () => {
    const result = await timed(() => wporg.probeWpOrgSlug('silent-plugin'));

    expect(result.error).toBeDefined();
    expect(result.error.name).toBe('TimeoutError');
    expect(result.elapsedMs).toBeLessThan(ENV_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });

  test('fetchPluginChangelog honours WPORG_TIMEOUT_MS', async () => {
    const result = await timed(() => wporg.fetchPluginChangelog('silent-plugin'));

    expect(result.error).toBeDefined();
    expect(result.error.name).toBe('TimeoutError');
    expect(result.elapsedMs).toBeLessThan(ENV_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });

  test('the high-priority lane records a timeout as an error and carries on', async () => {
    await db.query("INSERT INTO components (slug, component_type_slug, title, sync_priority_slug) VALUES ('silent-watched', 'wordpress-plugin', 'silent-watched', 'high')");
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await timed(() => wporg.syncHighPriorityPlugins());

    errorSpy.mockRestore();
    expect(result.value).toEqual({ synced: 0, unavailable: 0, transient: 0, errors: 1 });
    expect(result.elapsedMs).toBeLessThan(ENV_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });

  test('the WordPress core version sync fails safe on a timeout', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await timed(() => syncWordPressCoreVersion());

    errorSpy.mockRestore();
    expect(result.value).toEqual({ ok: false, reason: 'fetch_error' });
    expect(result.elapsedMs).toBeLessThan(ENV_TIMEOUT_MS * TIMEOUT_CEILING_FACTOR);
  });
});
