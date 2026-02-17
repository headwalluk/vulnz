'use strict';

/**
 * CLI Tests — bin/vulnz.js
 *
 * Tests for all user management commands using mocked dependencies.
 * Uses jest.isolateModulesAsync to give Commander a fresh program instance
 * per test, avoiding state leak between commands.
 */

// ─── Shared mock objects (referenced by jest.mock factories) ──────────────────
// Variables prefixed with 'mock' are allowed by Jest's hoisting rules.

const mockDb = {
  end: jest.fn().mockResolvedValue(undefined),
};

const mockUser = {
  createUser: jest.fn(),
  listAll: jest.fn(),
  findUserByUsername: jest.fn(),
  deleteUser: jest.fn(),
  updateUser: jest.fn(),
  updatePassword: jest.fn(),
};

const mockApiKey = {
  listByUserId: jest.fn(),
  createForUser: jest.fn(),
  findByKey: jest.fn(),
  revokeByKey: jest.fn(),
};

const mockFeed = {
  getStatus: jest.fn(),
  findComponentBySlug: jest.fn(),
  listReleasesBySlug: jest.fn(),
};

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/models/user', () => mockUser);
jest.mock('../../src/models/apiKey', () => mockApiKey);
jest.mock('../../src/models/feed', () => mockFeed);

// ─── runCli helper ────────────────────────────────────────────────────────────

/**
 * Run a CLI invocation and capture stdout, stderr, and exit code.
 *
 * Sets process.argv to the supplied args, loads bin/vulnz.js inside an
 * isolated module registry (so Commander starts fresh each time), then
 * waits for process.exit() to be called before resolving.
 *
 * @param {string[]} args - CLI arguments (without 'node' and script path)
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null}>}
 */
async function runCli(args) {
  const stdoutLines = [];
  const stderrLines = [];
  let exitCode = null;

  // Capture console.log output
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation((...a) => {
    stdoutLines.push(a.join(' '));
  });

  // Capture process.stderr.write output
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderrLines.push(String(s));
    return true;
  });

  // Intercept process.exit — record the exit code and signal completion
  let exitResolve;
  const exitPromise = new Promise((resolve) => {
    exitResolve = resolve;
  });

  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code ?? 0;
    exitResolve();
  });

  const savedArgv = process.argv;
  process.argv = ['node', 'bin/vulnz.js', ...args];

  try {
    await jest.isolateModulesAsync(async () => {
      require('../../bin/vulnz');

      // Wait for the async command action to call process.exit
      await Promise.race([
        exitPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`CLI did not call process.exit within 5 s for args: ${args.join(' ')}`)), 5000)),
      ]);
    });
  } finally {
    process.argv = savedArgv;
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutLines.join('\n'),
    stderr: stderrLines.join(''),
    exitCode,
  };
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.end.mockResolvedValue(undefined);
  mockApiKey.listByUserId.mockReset();
  mockApiKey.createForUser.mockReset();
  mockApiKey.findByKey.mockReset();
  mockApiKey.revokeByKey.mockReset();
  mockFeed.getStatus.mockReset();
  mockFeed.findComponentBySlug.mockReset();
  mockFeed.listReleasesBySlug.mockReset();
});

// ─── user:add ─────────────────────────────────────────────────────────────────

describe('CLI: user:add', () => {
  test('creates a regular user and exits 0', async () => {
    mockUser.createUser.mockResolvedValue({
      id: 1,
      username: 'alice@example.com',
      roles: ['user'],
    });

    const result = await runCli(['user:add', 'alice@example.com', 'SecureP@ss1']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Created user: alice@example\.com/);
    expect(result.stdout).toMatch(/id=1/);
    expect(result.stdout).toMatch(/roles=user/);
    expect(result.stderr).toBe('');

    // Verify the model was called with the correct email and roles
    expect(mockUser.createUser).toHaveBeenCalledTimes(1);
    const [email, , roleNames] = mockUser.createUser.mock.calls[0];
    expect(email).toBe('alice@example.com');
    expect(roleNames).toContain('user');
    expect(roleNames).not.toContain('administrator');
  });

  test('creates an admin user when --admin flag is set and exits 0', async () => {
    mockUser.createUser.mockResolvedValue({
      id: 2,
      username: 'bob@example.com',
      roles: ['user', 'administrator'],
    });

    const result = await runCli(['user:add', 'bob@example.com', 'AdminP@ss1', '--admin']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Created user: bob@example\.com/);
    expect(result.stdout).toMatch(/roles=user,administrator/);

    const [, , roleNames] = mockUser.createUser.mock.calls[0];
    expect(roleNames).toContain('user');
    expect(roleNames).toContain('administrator');
  });

  test('writes to stderr and exits 1 on error', async () => {
    mockUser.createUser.mockRejectedValue(new Error('Username already exists'));

    const result = await runCli(['user:add', 'duplicate@example.com', 'SecureP@ss1']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Username already exists/);
    expect(result.stdout).toBe('');
  });
});

// ─── user:list ────────────────────────────────────────────────────────────────

describe('CLI: user:list', () => {
  const sampleUsers = [
    { id: 1, username: 'alice@example.com', roles: ['user'], blocked: false, paused: false },
    { id: 2, username: 'bob@example.com', roles: ['user', 'administrator'], blocked: true, paused: false },
  ];

  test('outputs a formatted table of users and exits 0', async () => {
    mockUser.listAll.mockResolvedValue(sampleUsers);

    const result = await runCli(['user:list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/alice@example\.com/);
    expect(result.stdout).toMatch(/bob@example\.com/);
    // bob is blocked — status column should say BLOCKED
    expect(result.stdout).toMatch(/BLOCKED/);
    // alice is active
    expect(result.stdout).toMatch(/active/);
    // Table should include a header
    expect(result.stdout).toMatch(/USERNAME/);
  });

  test('prints "No users found." for an empty list and exits 0', async () => {
    mockUser.listAll.mockResolvedValue([]);

    const result = await runCli(['user:list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No users found/);
  });

  test('outputs valid JSON with --json flag and exits 0', async () => {
    mockUser.listAll.mockResolvedValue(sampleUsers);

    const result = await runCli(['user:list', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].username).toBe('alice@example.com');
    expect(parsed[1].username).toBe('bob@example.com');
  });

  test('writes to stderr and exits 1 on error', async () => {
    mockUser.listAll.mockRejectedValue(new Error('DB connection failed'));

    const result = await runCli(['user:list']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: DB connection failed/);
  });
});

// ─── user:delete ──────────────────────────────────────────────────────────────

describe('CLI: user:delete', () => {
  test('deletes an existing user and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'alice@example.com' });
    mockUser.deleteUser.mockResolvedValue(undefined);

    const result = await runCli(['user:delete', 'alice@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Deleted user: alice@example\.com/);
    expect(result.stdout).toMatch(/id=5/);
    expect(mockUser.deleteUser).toHaveBeenCalledWith(5);
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['user:delete', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockUser.deleteUser).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on unexpected error', async () => {
    mockUser.findUserByUsername.mockRejectedValue(new Error('Query timeout'));

    const result = await runCli(['user:delete', 'alice@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Query timeout/);
  });
});

// ─── user:block ───────────────────────────────────────────────────────────────

describe('CLI: user:block', () => {
  test('blocks an existing user and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockUser.updateUser.mockResolvedValue(undefined);

    const result = await runCli(['user:block', 'alice@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Blocked user: alice@example\.com/);
    expect(mockUser.updateUser).toHaveBeenCalledWith(3, { blocked: true });
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['user:block', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockUser.updateUser).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on unexpected error', async () => {
    mockUser.findUserByUsername.mockRejectedValue(new Error('Lock timeout'));

    const result = await runCli(['user:block', 'alice@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Lock timeout/);
  });
});

// ─── user:unblock ─────────────────────────────────────────────────────────────

describe('CLI: user:unblock', () => {
  test('unblocks an existing user and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockUser.updateUser.mockResolvedValue(undefined);

    const result = await runCli(['user:unblock', 'alice@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Unblocked user: alice@example\.com/);
    expect(mockUser.updateUser).toHaveBeenCalledWith(3, { blocked: false });
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['user:unblock', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockUser.updateUser).not.toHaveBeenCalled();
  });
});

// ─── user:reset-password ──────────────────────────────────────────────────────

describe('CLI: user:reset-password', () => {
  test('resets the password for an existing user and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 7, username: 'alice@example.com' });
    mockUser.updatePassword.mockResolvedValue(undefined);

    const result = await runCli(['user:reset-password', 'alice@example.com', 'NewPass@99']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Password reset for user: alice@example\.com/);
    expect(result.stdout).toMatch(/id=7/);
    expect(mockUser.updatePassword).toHaveBeenCalledWith(7, 'NewPass@99');
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['user:reset-password', 'ghost@example.com', 'NewPass@99']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockUser.updatePassword).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on unexpected error', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 7, username: 'alice@example.com' });
    mockUser.updatePassword.mockRejectedValue(new Error('Hash failed'));

    const result = await runCli(['user:reset-password', 'alice@example.com', 'BadPass']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Hash failed/);
  });
});

// ─── key:list ─────────────────────────────────────────────────────────────────

describe('CLI: key:list', () => {
  const sampleKeys = [
    { id: 1, api_key: 'aabbcc1122334455aabbcc1122334455aabbcc1122334455aabbcc1122334455', createdAt: new Date('2026-01-01T10:00:00.000Z') },
    { id: 2, api_key: 'ddeeff6677889900ddeeff6677889900ddeeff6677889900ddeeff6677889900', createdAt: new Date('2026-01-15T10:00:00.000Z') },
  ];

  test('outputs a formatted table of keys and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockApiKey.listByUserId.mockResolvedValue(sampleKeys);

    const result = await runCli(['key:list', 'alice@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/aabbcc1122334455/);
    expect(result.stdout).toMatch(/ddeeff6677889900/);
    expect(result.stdout).toMatch(/API KEY/);
    expect(mockApiKey.listByUserId).toHaveBeenCalledWith(3);
  });

  test('prints "No API keys found" when user has no keys and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockApiKey.listByUserId.mockResolvedValue([]);

    const result = await runCli(['key:list', 'alice@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No API keys found/);
  });

  test('outputs valid JSON with --json flag and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockApiKey.listByUserId.mockResolvedValue(sampleKeys);

    const result = await runCli(['key:list', 'alice@example.com', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].api_key).toBe(sampleKeys[0].api_key);
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['key:list', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockApiKey.listByUserId).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 3, username: 'alice@example.com' });
    mockApiKey.listByUserId.mockRejectedValue(new Error('DB timeout'));

    const result = await runCli(['key:list', 'alice@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: DB timeout/);
  });
});

// ─── key:generate ─────────────────────────────────────────────────────────────

describe('CLI: key:generate', () => {
  const SAMPLE_KEY = 'aabbcc1122334455aabbcc1122334455aabbcc1122334455aabbcc1122334455';

  test('generates a new key and exits 0', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 4, username: 'bob@example.com' });
    mockApiKey.createForUser.mockResolvedValue(SAMPLE_KEY);

    const result = await runCli(['key:generate', 'bob@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Generated API key for bob@example\.com/);
    expect(result.stdout).toMatch(SAMPLE_KEY);
    expect(mockApiKey.createForUser).toHaveBeenCalledWith(4);
  });

  test('writes to stderr and exits 1 when user is not found', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['key:generate', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockApiKey.createForUser).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 4, username: 'bob@example.com' });
    mockApiKey.createForUser.mockRejectedValue(new Error('Insert failed'));

    const result = await runCli(['key:generate', 'bob@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Insert failed/);
  });
});

// ─── key:revoke ───────────────────────────────────────────────────────────────

describe('CLI: key:revoke', () => {
  const SAMPLE_KEY = 'aabbcc1122334455aabbcc1122334455aabbcc1122334455aabbcc1122334455';

  test('revokes an existing key and exits 0', async () => {
    mockApiKey.findByKey.mockResolvedValue({ id: 1, api_key: SAMPLE_KEY, user_id: 3 });
    mockApiKey.revokeByKey.mockResolvedValue(undefined);

    const result = await runCli(['key:revoke', SAMPLE_KEY]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Revoked API key/);
    expect(result.stdout).toMatch(SAMPLE_KEY);
    expect(mockApiKey.revokeByKey).toHaveBeenCalledWith(SAMPLE_KEY);
  });

  test('writes to stderr and exits 1 when key is not found', async () => {
    mockApiKey.findByKey.mockResolvedValue(null);

    const result = await runCli(['key:revoke', 'nonexistentkey']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
    expect(mockApiKey.revokeByKey).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockApiKey.findByKey.mockResolvedValue({ id: 1, api_key: SAMPLE_KEY, user_id: 3 });
    mockApiKey.revokeByKey.mockRejectedValue(new Error('Delete failed'));

    const result = await runCli(['key:revoke', SAMPLE_KEY]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Delete failed/);
  });
});

// ─── feed:status ──────────────────────────────────────────────────────────────

describe('CLI: feed:status', () => {
  const sampleStatus = {
    components: 1200,
    releases: 54321,
    vulnerabilities: 789,
    lastSyncedAt: new Date('2026-01-15T10:30:00.000Z'),
  };

  test('outputs formatted feed status and exits 0', async () => {
    mockFeed.getStatus.mockResolvedValue(sampleStatus);

    const result = await runCli(['feed:status']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Feed Status/);
    expect(result.stdout).toMatch(/Components/);
    expect(result.stdout).toMatch(/1200/);
    expect(result.stdout).toMatch(/Releases/);
    expect(result.stdout).toMatch(/54321/);
    expect(result.stdout).toMatch(/Vulnerabilities/);
    expect(result.stdout).toMatch(/789/);
    expect(result.stdout).toMatch(/2026-01-15T10:30:00.000Z/);
    expect(result.stderr).toBe('');
    expect(mockFeed.getStatus).toHaveBeenCalledTimes(1);
  });

  test('shows "never" when lastSyncedAt is null and exits 0', async () => {
    mockFeed.getStatus.mockResolvedValue({ ...sampleStatus, lastSyncedAt: null });

    const result = await runCli(['feed:status']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/never/);
  });

  test('outputs valid JSON with --json flag and exits 0', async () => {
    mockFeed.getStatus.mockResolvedValue(sampleStatus);

    const result = await runCli(['feed:status', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.components).toBe(1200);
    expect(parsed.releases).toBe(54321);
    expect(parsed.vulnerabilities).toBe(789);
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockFeed.getStatus.mockRejectedValue(new Error('DB connection lost'));

    const result = await runCli(['feed:status']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: DB connection lost/);
    expect(result.stdout).toBe('');
  });
});

// ─── component:find ───────────────────────────────────────────────────────────

describe('CLI: component:find', () => {
  const sampleComponents = [{ id: 42, slug: 'woocommerce', type: 'plugin', title: 'WooCommerce', url: 'https://example.com', releaseCount: 300, vulnCount: 5 }];

  test('outputs a formatted component table and exits 0', async () => {
    mockFeed.findComponentBySlug.mockResolvedValue(sampleComponents);

    const result = await runCli(['component:find', 'woocommerce']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/ID/);
    expect(result.stdout).toMatch(/SLUG/);
    expect(result.stdout).toMatch(/TYPE/);
    expect(result.stdout).toMatch(/TITLE/);
    expect(result.stdout).toMatch(/woocommerce/);
    expect(result.stdout).toMatch(/WooCommerce/);
    expect(result.stdout).toMatch(/plugin/);
    expect(result.stderr).toBe('');
    expect(mockFeed.findComponentBySlug).toHaveBeenCalledWith('woocommerce');
  });

  test('prints "No component found" for an unknown slug and exits 0', async () => {
    mockFeed.findComponentBySlug.mockResolvedValue([]);

    const result = await runCli(['component:find', 'unknown-slug']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No component found with slug: unknown-slug/);
  });

  test('outputs valid JSON with --json flag and exits 0', async () => {
    mockFeed.findComponentBySlug.mockResolvedValue(sampleComponents);

    const result = await runCli(['component:find', 'woocommerce', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe('woocommerce');
    expect(parsed[0].type).toBe('plugin');
    expect(parsed[0].vulnCount).toBe(5);
  });

  test('returns multiple rows when slug matches both plugin and theme', async () => {
    const dualMatch = [
      { id: 1, slug: 'hello', type: 'plugin', title: 'Hello Plugin', url: null, releaseCount: 10, vulnCount: 0 },
      { id: 2, slug: 'hello', type: 'theme', title: 'Hello Theme', url: null, releaseCount: 5, vulnCount: 1 },
    ];
    mockFeed.findComponentBySlug.mockResolvedValue(dualMatch);

    const result = await runCli(['component:find', 'hello']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/plugin/);
    expect(result.stdout).toMatch(/theme/);
    expect(result.stdout).toMatch(/Hello Plugin/);
    expect(result.stdout).toMatch(/Hello Theme/);
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockFeed.findComponentBySlug.mockRejectedValue(new Error('Query failed'));

    const result = await runCli(['component:find', 'woocommerce']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Query failed/);
    expect(result.stdout).toBe('');
  });
});

// ─── release:list ─────────────────────────────────────────────────────────────

describe('CLI: release:list', () => {
  const sampleReleases = [
    { id: 10, version: '8.5.0', vulnCount: 2, slug: 'woocommerce', title: 'WooCommerce', type: 'plugin' },
    { id: 9, version: '8.4.1', vulnCount: 0, slug: 'woocommerce', title: 'WooCommerce', type: 'plugin' },
    { id: 8, version: '8.4.0', vulnCount: 1, slug: 'woocommerce', title: 'WooCommerce', type: 'plugin' },
  ];

  test('outputs a formatted release table and exits 0', async () => {
    mockFeed.listReleasesBySlug.mockResolvedValue(sampleReleases);

    const result = await runCli(['release:list', 'woocommerce']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Component: woocommerce/);
    expect(result.stdout).toMatch(/WooCommerce/);
    expect(result.stdout).toMatch(/plugin/);
    expect(result.stdout).toMatch(/VERSION/);
    expect(result.stdout).toMatch(/8\.5\.0/);
    expect(result.stdout).toMatch(/8\.4\.1/);
    expect(result.stdout).toMatch(/8\.4\.0/);
    // 3 releases listed
    expect(result.stdout).toMatch(/3 release\(s\) listed/);
    expect(result.stderr).toBe('');
    expect(mockFeed.listReleasesBySlug).toHaveBeenCalledWith('woocommerce');
  });

  test('shows vuln counts for affected versions and dashes for clean versions', async () => {
    mockFeed.listReleasesBySlug.mockResolvedValue(sampleReleases);

    const result = await runCli(['release:list', 'woocommerce']);

    expect(result.exitCode).toBe(0);
    // 8.5.0 has 2 vulns, 8.4.0 has 1 vuln — should show numbers, not dashes
    expect(result.stdout).toMatch(/8\.5\.0\s+2/);
    expect(result.stdout).toMatch(/8\.4\.0\s+1/);
    // 8.4.1 has 0 vulns — should show a dash
    expect(result.stdout).toMatch(/8\.4\.1\s+-/);
  });

  test('prints "No releases found" for an unknown slug and exits 0', async () => {
    mockFeed.listReleasesBySlug.mockResolvedValue([]);

    const result = await runCli(['release:list', 'unknown-plugin']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No releases found for component: unknown-plugin/);
  });

  test('outputs valid JSON with --json flag and exits 0', async () => {
    mockFeed.listReleasesBySlug.mockResolvedValue(sampleReleases);

    const result = await runCli(['release:list', 'woocommerce', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].version).toBe('8.5.0');
    expect(parsed[0].vulnCount).toBe(2);
    expect(parsed[1].vulnCount).toBe(0);
  });

  test('writes to stderr and exits 1 on model error', async () => {
    mockFeed.listReleasesBySlug.mockRejectedValue(new Error('Timeout'));

    const result = await runCli(['release:list', 'woocommerce']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Timeout/);
    expect(result.stdout).toBe('');
  });
});
