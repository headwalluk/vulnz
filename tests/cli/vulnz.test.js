'use strict';

/**
 * CLI Tests — bin/vulnz
 *
 * Tests for all user management commands using mocked dependencies.
 * Uses jest.isolateModulesAsync to give Commander a fresh program instance
 * per test, avoiding state leak between commands.
 */

// ─── Shared mock objects (referenced by jest.mock factories) ──────────────────
// Variables prefixed with 'mock' are allowed by Jest's hoisting rules.

const mockDb = {
  end: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
};

const mockUser = {
  createUser: jest.fn(),
  listAll: jest.fn(),
  findUserByUsername: jest.fn(),
  deleteUser: jest.fn(),
  updateUser: jest.fn(),
  updatePassword: jest.fn(),
  findUserById: jest.fn(),
  getRoles: jest.fn(),
  addRole: jest.fn(),
  removeRole: jest.fn(),
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

const mockComponent = {
  findByTypeAndSlug: jest.fn(),
  findOrCreate: jest.fn(),
  flagAsMalware: jest.fn(),
  clearMalwareFlag: jest.fn(),
  findMalware: jest.fn(),
};

const mockWporg = {
  probeWpOrgSlug: jest.fn(),
  syncHighPriorityPlugins: jest.fn(),
  fetchPluginChangelog: jest.fn(),
  WPORG_STATUS_AVAILABLE: 'available',
  WPORG_STATUS_CLOSED: 'closed',
};

const mockReleaseFeed = {
  FEED_TYPE_WORDPRESSORG: 'wordpressorg',
  FEED_URL_MAX_LENGTH: 2048,
  typeExists: jest.fn(),
  findTypes: jest.fn(),
  addType: jest.fn(),
  findByComponentId: jest.fn(),
  list: jest.fn(),
  save: jest.fn(),
  setEnabled: jest.fn(),
  remove: jest.fn(),
  findCandidates: jest.fn(),
};

const mockWebsite = {
  findAllByDomain: jest.fn(),
  findByDomain: jest.fn(),
  findAll: jest.fn(),
  countAll: jest.fn(),
  remove: jest.fn(),
  SORTS: ['newest', 'vulnerabilities', 'malware', 'severity'],
  SORT_NEWEST: 'newest',
};

const mockWebsiteComponent = {
  getPlugins: jest.fn(),
  getThemes: jest.fn(),
};

const mockEmailer = {
  describeTransport: jest.fn(),
  sendTestEmail: jest.fn(),
};

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));
// The CLI tests supply their environment directly, so skip the .env file check.
jest.mock('../../src/lib/env', () => ({ ...jest.requireActual('../../src/lib/env'), loadEnvFile: jest.fn() }));
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/models/user', () => mockUser);
jest.mock('../../src/models/apiKey', () => mockApiKey);
jest.mock('../../src/models/feed', () => mockFeed);
jest.mock('../../src/models/component', () => mockComponent);
jest.mock('../../src/lib/wporg', () => mockWporg);
jest.mock('../../src/models/releaseFeed', () => mockReleaseFeed);
jest.mock('../../src/lib/email', () => mockEmailer);
jest.mock('../../src/models/website', () => mockWebsite);
jest.mock('../../src/models/websiteComponent', () => mockWebsiteComponent);

// ─── runCli helper ────────────────────────────────────────────────────────────

/**
 * Run a CLI invocation and capture stdout, stderr, and exit code.
 *
 * Sets process.argv to the supplied args, loads bin/vulnz inside an
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
  process.argv = ['node', 'bin/vulnz', ...args];

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
  mockDb.query.mockReset();
  mockComponent.findByTypeAndSlug.mockReset();
  mockComponent.findOrCreate.mockReset();
  mockComponent.flagAsMalware.mockReset();
  mockComponent.clearMalwareFlag.mockReset();
  mockComponent.findMalware.mockReset();
  mockWporg.probeWpOrgSlug.mockReset();
  for (const mockFunction of Object.values(mockReleaseFeed).filter((value) => typeof value === 'function')) {
    mockFunction.mockReset();
  }
  mockEmailer.describeTransport.mockReset();
  mockEmailer.sendTestEmail.mockReset();
  for (const mockFunction of [...Object.values(mockWebsite), ...Object.values(mockWebsiteComponent)].filter((value) => typeof value === 'function')) {
    mockFunction.mockReset();
  }
  mockUser.findUserById.mockReset();
  mockUser.findUserByUsername.mockReset();
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

describe('CLI: key:show', () => {
  const SAMPLE_KEY = 'ddeeff1122334455ddeeff1122334455ddeeff1122334455ddeeff1122334455';

  test("shows the owner, roles and access of an administrator's key", async () => {
    mockApiKey.findByKey.mockResolvedValue({ id: 7, api_key: SAMPLE_KEY, user_id: 3, createdAt: new Date('2026-08-16T10:00:00Z') });
    mockUser.findUserById.mockResolvedValue({ id: 3, username: 'agent@example.com', blocked: 0, paused: 0 });
    mockUser.getRoles.mockResolvedValue(['user', 'administrator']);

    const result = await runCli(['key:show', SAMPLE_KEY]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Owner: agent@example.com \(id=3\)/);
    expect(result.stdout).toMatch(/Roles: user, administrator/);
    expect(result.stdout).toMatch(/Access: every account/);
    expect(result.stdout).toMatch(/2026-08-16T10:00:00.000Z/);
  });

  test('--json describes a user key as own-websites-only', async () => {
    mockApiKey.findByKey.mockResolvedValue({ id: 8, api_key: SAMPLE_KEY, user_id: 4, createdAt: '2026-09-01 00:00:00' });
    mockUser.findUserById.mockResolvedValue({ id: 4, username: 'customer@example.com', blocked: 0, paused: 1 });
    mockUser.getRoles.mockResolvedValue(['user']);

    const result = await runCli(['key:show', SAMPLE_KEY, '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ id: 8, user_id: 4, username: 'customer@example.com', status: 'paused', roles: ['user'], access: 'own websites only' });
  });

  test('describes an ingest key', async () => {
    mockApiKey.findByKey.mockResolvedValue({ id: 9, api_key: SAMPLE_KEY, user_id: 5, createdAt: '2026-10-03 00:00:00' });
    mockUser.findUserById.mockResolvedValue({ id: 5, username: 'ingest@example.com', blocked: 0, paused: 0 });
    mockUser.getRoles.mockResolvedValue(['user', 'ingest']);

    const result = await runCli(['key:show', SAMPLE_KEY]);

    expect(result.stdout).toMatch(/Access: own websites, plus writes to the shared vulnerability and release data/);
  });

  test('exits 1 for an unknown key', async () => {
    mockApiKey.findByKey.mockResolvedValue(null);

    const result = await runCli(['key:show', 'nope']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/i);
  });
});

describe('CLI: user:role:add / user:role:remove', () => {
  test('grants a role', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'agent@example.com' });
    mockUser.addRole.mockResolvedValue(true);
    mockUser.getRoles.mockResolvedValue(['user', 'administrator']);

    const result = await runCli(['user:role:add', 'agent@example.com', 'administrator']);

    expect(result.exitCode).toBe(0);
    expect(mockUser.addRole).toHaveBeenCalledWith(5, 'administrator');
    expect(result.stdout).toMatch(/Granted 'administrator'/);
  });

  test('reports a role the user already has', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'agent@example.com' });
    mockUser.addRole.mockResolvedValue(false);
    mockUser.getRoles.mockResolvedValue(['user']);

    const result = await runCli(['user:role:add', 'agent@example.com', 'user']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/already has 'user'/);
  });

  test('exits 1 for an unknown role', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'agent@example.com' });
    mockUser.addRole.mockRejectedValue(new Error("Unknown role 'superuser'."));

    const result = await runCli(['user:role:add', 'agent@example.com', 'superuser']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Unknown role 'superuser'/);
  });

  test('removes a role', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'agent@example.com' });
    mockUser.removeRole.mockResolvedValue(true);
    mockUser.getRoles.mockResolvedValue(['user']);

    const result = await runCli(['user:role:remove', 'agent@example.com', 'administrator']);

    expect(result.exitCode).toBe(0);
    expect(mockUser.removeRole).toHaveBeenCalledWith(5, 'administrator');
    expect(result.stdout).toMatch(/Removed 'administrator'.*Roles: user/);
  });

  test('exits 1 when removing the last role', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'agent@example.com' });
    mockUser.removeRole.mockRejectedValue(new Error("'user' is the user's only role; add another role first."));

    const result = await runCli(['user:role:remove', 'agent@example.com', 'user']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/only role/);
  });

  test('exits 1 for an unknown user', async () => {
    mockUser.findUserByUsername.mockResolvedValue(undefined);

    const result = await runCli(['user:role:remove', 'nobody@example.com', 'user']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not found/);
    expect(mockUser.removeRole).not.toHaveBeenCalled();
  });
});

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

// ─── component:malware:add ────────────────────────────────────────────────────

describe('CLI: component:malware:add', () => {
  const PLUGIN_TYPE = 'wordpress-plugin';

  /**
   * Answer the two direct db.query calls the command makes: the component
   * type existence check, and the release count.
   */
  function mockDbForFlag({ knownType = true, releaseCount = 0 } = {}) {
    mockDb.query.mockImplementation(async (sql) => {
      if (/FROM component_types/.test(sql)) {
        return knownType ? [{ slug: PLUGIN_TYPE }] : [];
      }
      if (/COUNT\(\*\) AS total FROM releases/.test(sql)) {
        return [{ total: releaseCount }];
      }
      return [];
    });
  }

  test('flags a slug that is absent from wordpress.org and exits 0', async () => {
    mockDbForFlag({ releaseCount: 3 });
    mockWporg.probeWpOrgSlug.mockResolvedValue({ status: 404, available: false, name: null });
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 77, slug: 'easypost', is_malware: 0 });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'easypost', '--summary', 'Backdoor file dropper']);

    expect(result.exitCode).toBe(0);
    expect(mockComponent.flagAsMalware).toHaveBeenCalledWith(77, { summary: 'Backdoor file dropper', url: null });
    expect(result.stdout).toMatch(/Flagged as malware: wordpress-plugin\/easypost/);
    expect(result.stdout).toMatch(/all 3 known release\(s\)/);
    expect(result.stderr).toBe('');
  });

  test('refuses to flag a slug that is published on wordpress.org', async () => {
    mockDbForFlag();
    mockWporg.probeWpOrgSlug.mockResolvedValue({ status: 200, available: true, name: 'Contact Form 7' });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'contact-form-7']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/published on wordpress\.org as "Contact Form 7"/);
    expect(result.stderr).toMatch(/--force/);
    expect(mockComponent.flagAsMalware).not.toHaveBeenCalled();
  });

  test('--force flags a published slug anyway', async () => {
    mockDbForFlag({ releaseCount: 1 });
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 88, slug: 'contact-form-7', is_malware: 0 });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'contact-form-7', '--force']);

    expect(result.exitCode).toBe(0);
    expect(mockWporg.probeWpOrgSlug).not.toHaveBeenCalled();
    expect(mockComponent.flagAsMalware).toHaveBeenCalledWith(88, { summary: null, url: null });
  });

  test('warns but proceeds when wordpress.org cannot be reached', async () => {
    mockDbForFlag();
    mockWporg.probeWpOrgSlug.mockRejectedValue(new Error('ETIMEDOUT'));
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 99, slug: 'easypost', is_malware: 0 });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'easypost']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Warning: could not reach wordpress\.org/);
    expect(mockComponent.flagAsMalware).toHaveBeenCalled();
  });

  test('does not probe wordpress.org for non-plugin component types', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (/FROM component_types/.test(sql)) {
        return [{ slug: 'npm-package' }];
      }
      return [{ total: 0 }];
    });
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 5, slug: 'evil-pkg', is_malware: 0 });

    const result = await runCli(['component:malware:add', 'npm-package', 'evil-pkg']);

    expect(result.exitCode).toBe(0);
    expect(mockWporg.probeWpOrgSlug).not.toHaveBeenCalled();
  });

  test('rejects a slug that sanitizes to nothing, rather than creating a junk row', async () => {
    mockDbForFlag();

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, '']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not a usable component slug/);
    expect(mockComponent.findOrCreate).not.toHaveBeenCalled();
    expect(mockComponent.flagAsMalware).not.toHaveBeenCalled();
  });

  test('rejects an unknown component type and exits 1', async () => {
    mockDbForFlag({ knownType: false });

    const result = await runCli(['component:malware:add', 'wordpress-plugni', 'easypost']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/unknown component type "wordpress-plugni"/);
    expect(mockComponent.flagAsMalware).not.toHaveBeenCalled();
  });

  test('creates the component when the slug has not been ingested yet', async () => {
    mockDbForFlag();
    mockWporg.probeWpOrgSlug.mockResolvedValue({ status: 404, available: false, name: null });
    mockComponent.findByTypeAndSlug.mockResolvedValue(undefined);
    mockComponent.findOrCreate.mockResolvedValue({ id: 123, slug: 'easypost' });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'easypost']);

    expect(result.exitCode).toBe(0);
    expect(mockComponent.findOrCreate).toHaveBeenCalledWith('easypost', PLUGIN_TYPE, 'easypost');
    expect(result.stdout).toMatch(/Created component: easypost/);
    expect(mockComponent.flagAsMalware).toHaveBeenCalledWith(123, { summary: null, url: null });
  });

  test('re-flagging an already-flagged component updates it and says so', async () => {
    mockDbForFlag({ releaseCount: 2 });
    mockWporg.probeWpOrgSlug.mockResolvedValue({ status: 404, available: false, name: null });
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 77, slug: 'easypost', is_malware: 1 });

    const result = await runCli(['component:malware:add', PLUGIN_TYPE, 'easypost', '--summary', 'Updated wording']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/already flagged/);
    expect(mockComponent.flagAsMalware).toHaveBeenCalledWith(77, { summary: 'Updated wording', url: null });
  });
});

// ─── component:malware:remove ─────────────────────────────────────────────────

describe('CLI: component:malware:remove', () => {
  test('clears the flag and exits 0', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 77, slug: 'easypost', is_malware: 1 });

    const result = await runCli(['component:malware:remove', 'wordpress-plugin', 'easypost']);

    expect(result.exitCode).toBe(0);
    expect(mockComponent.clearMalwareFlag).toHaveBeenCalledWith(77);
    expect(result.stdout).toMatch(/Cleared malware flag: wordpress-plugin\/easypost/);
  });

  test('reports an unflagged component without touching it', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 77, slug: 'easypost', is_malware: 0 });

    const result = await runCli(['component:malware:remove', 'wordpress-plugin', 'easypost']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Not flagged as malware/);
    expect(mockComponent.clearMalwareFlag).not.toHaveBeenCalled();
  });

  test('reports an unknown component', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue(undefined);

    const result = await runCli(['component:malware:remove', 'wordpress-plugin', 'nope']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No component found: wordpress-plugin\/nope/);
    expect(mockComponent.clearMalwareFlag).not.toHaveBeenCalled();
  });
});

// ─── component:malware:list ───────────────────────────────────────────────────

describe('CLI: component:malware:list', () => {
  const flagged = [
    {
      id: 77,
      slug: 'easypost',
      component_type_slug: 'wordpress-plugin',
      title: 'easypost',
      malware_summary: 'Backdoor file dropper',
      malware_source_slug: 'manual',
      malware_flagged_at: '2026-08-12T09:00:00.000Z',
      release_count: 2,
    },
  ];

  test('outputs a formatted table and exits 0', async () => {
    mockComponent.findMalware.mockResolvedValue(flagged);

    const result = await runCli(['component:malware:list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/SLUG/);
    expect(result.stdout).toMatch(/easypost/);
    expect(result.stdout).toMatch(/Backdoor file dropper/);
    expect(result.stdout).toMatch(/1 component\(s\) flagged/);
    expect(result.stderr).toBe('');
  });

  test('outputs valid JSON with --json', async () => {
    mockComponent.findMalware.mockResolvedValue(flagged);

    const result = await runCli(['component:malware:list', '--json']);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe('easypost');
    expect(parsed[0].release_count).toBe(2);
  });

  test('reports an empty list', async () => {
    mockComponent.findMalware.mockResolvedValue([]);

    const result = await runCli(['component:malware:list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No components are flagged as malware/);
  });
});

// ─── component:feed:* ─────────────────────────────────────────────────────────

describe('CLI: component:feed:*', () => {
  const PLUGIN_TYPE = 'wordpress-plugin';
  const FEED_URL = 'https://api.github.com/repos/headwalluk/quick-2fa/releases/latest';
  const storedFeed = {
    component_id: 42,
    component_type_slug: PLUGIN_TYPE,
    slug: 'quick-2fa',
    feed_type: 'github-releases',
    feed_url: FEED_URL,
    params: null,
    is_enabled: true,
    latest_version: '1.6.0',
    latest_version_source: 'github-releases',
    last_checked_at: null,
    last_success_at: null,
    last_version_found: null,
    consecutive_failures: 0,
    last_error: null,
  };
  const setFeed = (...extra) => runCli(['component:feed:set', PLUGIN_TYPE, 'quick-2fa', '--feed-type', 'github-releases', '--url', FEED_URL, ...extra]);

  beforeEach(() => {
    mockReleaseFeed.typeExists.mockResolvedValue(true);
    mockReleaseFeed.save.mockResolvedValue({ created: true, statusReset: false });
    mockReleaseFeed.findByComponentId.mockResolvedValue(storedFeed);
  });

  test('set creates a feed for an existing component', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 42, slug: 'quick-2fa', wporg_status_slug: 'absent' });

    const result = await setFeed('--params', '{"repo": "headwalluk/quick-2fa"}');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Created release feed: wordpress-plugin\/quick-2fa/);
    expect(mockReleaseFeed.save).toHaveBeenCalledWith(42, { feedType: 'github-releases', feedUrl: FEED_URL, params: { repo: 'headwalluk/quick-2fa' } });
  });

  test('set refuses a component nobody has reported', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue(undefined);

    const result = await setFeed();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/no component found/);
    expect(mockReleaseFeed.save).not.toHaveBeenCalled();
  });

  test('set refuses an http URL and a params credential', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 42, slug: 'quick-2fa', wporg_status_slug: 'absent' });

    const insecure = await runCli(['component:feed:set', PLUGIN_TYPE, 'quick-2fa', '--feed-type', 'rss', '--url', 'http://example.test/feed']);
    expect(insecure.exitCode).toBe(1);
    expect(insecure.stderr).toMatch(/https:\/\//);

    const secret = await setFeed('--params', '{"license_key": "abc"}');
    expect(secret.exitCode).toBe(1);
    expect(secret.stderr).toMatch(/must not hold credentials/);
    expect(mockReleaseFeed.save).not.toHaveBeenCalled();
  });

  test('set refuses a plugin wordpress.org publishes unless forced', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 7, slug: 'relevanssi', wporg_status_slug: 'available' });

    const refused = await setFeed();
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toMatch(/published on wordpress\.org/);
    expect(mockReleaseFeed.save).not.toHaveBeenCalled();

    const forced = await setFeed('--force');
    expect(forced.exitCode).toBe(0);
    expect(mockReleaseFeed.save).toHaveBeenCalledTimes(1);
  });

  test('set says when a changed URL cleared the history', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 42, slug: 'quick-2fa', wporg_status_slug: 'absent' });
    mockReleaseFeed.save.mockResolvedValue({ created: false, statusReset: true });

    const result = await setFeed();

    expect(result.stdout).toMatch(/Updated release feed/);
    expect(result.stdout).toMatch(/check history has been cleared/);
  });

  test('disable and remove report a missing feed', async () => {
    mockComponent.findByTypeAndSlug.mockResolvedValue({ id: 42, slug: 'quick-2fa' });
    mockReleaseFeed.setEnabled.mockResolvedValue(false);
    mockReleaseFeed.remove.mockResolvedValue(false);

    const disabled = await runCli(['component:feed:disable', PLUGIN_TYPE, 'quick-2fa']);
    expect(disabled.exitCode).toBe(1);
    expect(mockReleaseFeed.setEnabled).toHaveBeenCalledWith(42, false);

    const removed = await runCli(['component:feed:remove', PLUGIN_TYPE, 'quick-2fa']);
    expect(removed.exitCode).toBe(1);
    expect(removed.stderr).toMatch(/no release feed/);
  });

  test('candidates sorts the versions and passes the options through', async () => {
    mockReleaseFeed.findCandidates.mockResolvedValue([
      {
        slug: 'premium-search',
        title: 'Premium Search',
        site_count: 5,
        owner_count: 1,
        wporg_status: 'absent',
        versions: ['2.9.1', '2.30.2', '2.10.0'],
        latest_version: null,
        latest_version_source: null,
        feed_type: null,
      },
    ]);

    const result = await runCli(['component:feed:candidates', '--min-sites', '3', '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)[0].versions).toEqual(['2.9.1', '2.10.0', '2.30.2']);
    expect(mockReleaseFeed.findCandidates).toHaveBeenCalledWith({ componentType: PLUGIN_TYPE, minSites: 3, includeFed: false, limit: 50 });
  });

  test('candidates rejects a non-numeric --min-sites', async () => {
    const result = await runCli(['component:feed:candidates', '--min-sites', 'two']);
    expect(result.exitCode).toBe(1);
    expect(mockReleaseFeed.findCandidates).not.toHaveBeenCalled();
  });

  test('type:add checks the slug', async () => {
    mockReleaseFeed.addType.mockResolvedValue(true);

    const refused = await runCli(['component:feed:type:add', 'Free Mius', 'Freemius']);
    expect(refused.exitCode).toBe(1);

    const added = await runCli(['component:feed:type:add', 'freemius', 'Freemius']);
    expect(added.exitCode).toBe(0);
    expect(mockReleaseFeed.addType).toHaveBeenCalledWith('freemius', 'Freemius');
  });
});

// ─── email:test ───────────────────────────────────────────────────────────────

describe('email:test', () => {
  const SETTINGS = {
    host: 'smtp.example.com',
    port: '587',
    secure: false,
    user: 'vulnz@example.com',
    passwordSet: true,
    from: 'VULNZ <vulnz@example.com>',
    ignoreTls: false,
    smtpEnabled: true,
  };
  const SENT = { messageId: '<test@example.com>', accepted: ['admin@example.com'], rejected: [], response: '250 OK queued' };

  test('sends a test email and reports the server response', async () => {
    mockEmailer.describeTransport.mockReturnValue(SETTINGS);
    mockEmailer.sendTestEmail.mockResolvedValue(SENT);

    const result = await runCli(['email:test', 'admin@example.com']);

    expect(result.exitCode).toBe(0);
    expect(mockEmailer.sendTestEmail).toHaveBeenCalledWith('admin@example.com', expect.objectContaining({ version: expect.any(String) }));
    expect(result.stdout).toContain('250 OK queued');
    expect(result.stdout).not.toContain('SMTP sending is disabled');
  });

  test('says SMTP sending is disabled while SMTP_ENABLED is off, and still sends', async () => {
    mockEmailer.describeTransport.mockReturnValue({ ...SETTINGS, smtpEnabled: false });
    mockEmailer.sendTestEmail.mockResolvedValue(SENT);

    const result = await runCli(['email:test', 'admin@example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('SMTP sending is disabled');
    expect(mockEmailer.sendTestEmail).toHaveBeenCalledTimes(1);
  });

  test('never prints the password', async () => {
    mockEmailer.describeTransport.mockReturnValue(SETTINGS);
    mockEmailer.sendTestEmail.mockResolvedValue(SENT);

    const result = await runCli(['email:test', 'admin@example.com', '--json']);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).settings.passwordSet).toBe(true);
    expect(result.stdout).not.toMatch(/"pass(word)?"\s*:/);
  });

  test('refuses an invalid address without connecting', async () => {
    const result = await runCli(['email:test', 'not-an-address']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not a valid email address/);
    expect(mockEmailer.sendTestEmail).not.toHaveBeenCalled();
  });

  test('reports a login failure with its error code', async () => {
    mockEmailer.describeTransport.mockReturnValue(SETTINGS);
    mockEmailer.sendTestEmail.mockRejectedValue(Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH' }));

    const result = await runCli(['email:test', 'admin@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('EAUTH: Invalid login');
  });

  test('exits 1 when the server rejects the recipient', async () => {
    mockEmailer.describeTransport.mockReturnValue(SETTINGS);
    mockEmailer.sendTestEmail.mockResolvedValue({ ...SENT, accepted: [], rejected: ['admin@example.com'] });

    const result = await runCli(['email:test', 'admin@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Rejected: admin@example.com');
  });
});

// ─── website:remove ───────────────────────────────────────────────────────────

describe('CLI: website:remove', () => {
  const ALICE_SITE = { id: 11, domain: 'one.example.com', title: 'One', user_id: 5, owner: 'alice@example.com', component_count: 12 };
  const BOB_COPY = { id: 12, domain: 'one.example.com', title: 'One', user_id: 6, owner: 'bob@example.com', component_count: 3 };
  const SECOND_SITE = { id: 21, domain: 'two.example.com', title: 'Two', user_id: 5, owner: 'alice@example.com', component_count: 0 };

  test('without --yes lists what would be removed and deletes nothing', async () => {
    mockWebsite.findAllByDomain.mockImplementation(async (domain) => (domain === 'one.example.com' ? [ALICE_SITE] : [SECOND_SITE]));

    const result = await runCli(['website:remove', 'one.example.com', 'two.example.com']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Would remove: one\.example\.com \(id=11, owner=alice@example\.com, components=12\)/);
    expect(result.stdout).toMatch(/Would remove: two\.example\.com/);
    expect(result.stdout).toMatch(/Dry run/);
    expect(mockWebsite.remove).not.toHaveBeenCalled();
  });

  test('with --yes removes every named website', async () => {
    mockWebsite.findAllByDomain.mockImplementation(async (domain) => (domain === 'one.example.com' ? [ALICE_SITE] : [SECOND_SITE]));
    mockWebsite.remove.mockResolvedValue(true);

    const result = await runCli(['website:remove', 'one.example.com', 'two.example.com', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Removed: one\.example\.com/);
    expect(result.stdout).not.toMatch(/Dry run/);
    expect(mockWebsite.remove).toHaveBeenCalledWith(11);
    expect(mockWebsite.remove).toHaveBeenCalledWith(21);
  });

  test('removes nothing when any domain is not found', async () => {
    mockWebsite.findAllByDomain.mockImplementation(async (domain) => (domain === 'one.example.com' ? [ALICE_SITE] : []));

    const result = await runCli(['website:remove', 'one.example.com', 'missing.example.com', '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/'missing\.example\.com' not found/);
    expect(result.stderr).toMatch(/Nothing was removed/);
    expect(mockWebsite.remove).not.toHaveBeenCalled();
  });

  test('refuses a domain held by several accounts without --owner', async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_SITE, BOB_COPY]);

    const result = await runCli(['website:remove', 'one.example.com', '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/more than one account \(alice@example\.com, bob@example\.com\)/);
    expect(mockWebsite.remove).not.toHaveBeenCalled();
  });

  test("--owner picks one account's copy, case-insensitively", async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_SITE, BOB_COPY]);
    mockWebsite.remove.mockResolvedValue(true);

    const result = await runCli(['website:remove', 'one.example.com', '--owner', 'BOB@example.com', '--yes']);

    expect(result.exitCode).toBe(0);
    expect(mockWebsite.remove).toHaveBeenCalledTimes(1);
    expect(mockWebsite.remove).toHaveBeenCalledWith(12);
  });

  test('--owner that matches no copy is an error', async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_SITE]);

    const result = await runCli(['website:remove', 'one.example.com', '--owner', 'carol@example.com', '--yes']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not owned by carol@example\.com \(owners: alice@example\.com\)/);
    expect(mockWebsite.remove).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on unexpected error', async () => {
    mockWebsite.findAllByDomain.mockRejectedValue(new Error('Query timeout'));

    const result = await runCli(['website:remove', 'one.example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Query timeout/);
  });
});

// ─── website:list ─────────────────────────────────────────────────────────────

describe('CLI: website:list', () => {
  const LIST_ROWS = [
    { id: 11, domain: 'one.example.com', title: 'One', user_id: 5, is_dev: 0, vulnerability_count: 2, malware_count: 0, versions_last_checked_at: '2026-11-01T10:00:00Z' },
    { id: 12, domain: 'two.example.com', title: 'Two', user_id: 6, is_dev: 1, vulnerability_count: 0, malware_count: 1, versions_last_checked_at: null },
  ];

  beforeEach(() => {
    mockUser.findUserById.mockImplementation(async (userId) => ({ id: userId, username: userId === 5 ? 'alice@example.com' : 'bob@example.com' }));
  });

  test('lists websites across every account with owner and counts', async () => {
    mockWebsite.findAll.mockResolvedValue(LIST_ROWS);
    mockWebsite.countAll.mockResolvedValue(40);

    const result = await runCli(['website:list']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/one\.example\.com\s+alice@example\.com\s+no\s+2\s+0\s+2026-11-01 10:00:00/);
    expect(result.stdout).toMatch(/two\.example\.com\s+bob@example\.com\s+yes\s+0\s+1\s+-/);
    expect(result.stdout).toMatch(/Showing 2 of 40\./);
    expect(mockWebsite.findAll).toHaveBeenCalledWith(null, 50, 0, null, false, expect.objectContaining({ ownerId: null, isDev: null, staleDays: null, sort: 'newest' }));
  });

  test('passes filters through to the model', async () => {
    mockUser.findUserByUsername.mockResolvedValue({ id: 5, username: 'alice@example.com' });
    mockWebsite.findAll.mockResolvedValue([]);
    mockWebsite.countAll.mockResolvedValue(0);

    const result = await runCli([
      'website:list',
      '--owner',
      'alice@example.com',
      '--search',
      'shop',
      '--component',
      'akismet',
      '--vulnerable',
      '--live',
      '--stale',
      '30',
      '--sort',
      'severity',
      '--limit',
      '10',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No websites match/);
    expect(mockWebsite.findAll).toHaveBeenCalledWith(null, 10, 0, 'shop', true, {
      ownerId: 5,
      isDev: false,
      staleDays: 30,
      sort: 'severity',
      componentSlug: 'akismet',
    });
  });

  test('--json prints websites and total', async () => {
    mockWebsite.findAll.mockResolvedValue([LIST_ROWS[0]]);
    mockWebsite.countAll.mockResolvedValue(1);

    const result = await runCli(['website:list', '--json']);
    const parsed = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(parsed.total).toBe(1);
    expect(parsed.websites[0]).toMatchObject({ id: 11, domain: 'one.example.com', owner: 'alice@example.com', is_dev: false, vulnerability_count: 2 });
  });

  test('reports every invalid option at once and queries nothing', async () => {
    mockUser.findUserByUsername.mockResolvedValue(null);

    const result = await runCli(['website:list', '--limit', '0', '--stale', 'soon', '--sort', 'bogus', '--dev', '--live', '--owner', 'ghost@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--limit must be a positive integer/);
    expect(result.stderr).toMatch(/--stale must be a positive integer/);
    expect(result.stderr).toMatch(/--sort must be one of: newest, vulnerabilities, malware, severity/);
    expect(result.stderr).toMatch(/--dev and --live cannot be used together/);
    expect(result.stderr).toMatch(/User 'ghost@example\.com' not found/);
    expect(mockWebsite.findAll).not.toHaveBeenCalled();
  });

  test('writes to stderr and exits 1 on unexpected error', async () => {
    mockWebsite.findAll.mockRejectedValue(new Error('Query timeout'));

    const result = await runCli(['website:list']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Error: Query timeout/);
  });
});

// ─── website:show ─────────────────────────────────────────────────────────────

describe('CLI: website:show', () => {
  const ALICE_COPY = { id: 11, domain: 'one.example.com', title: 'One', user_id: 5, owner: 'alice@example.com', component_count: 3 };
  const BOB_COPY = { id: 12, domain: 'one.example.com', title: 'One', user_id: 6, owner: 'bob@example.com', component_count: 0 };
  const FULL_ROW = {
    id: 11,
    domain: 'one.example.com',
    title: 'One',
    user_id: 5,
    is_dev: 0,
    is_ssl: 1,
    wordpress_version: '6.8.1',
    php_version: '8.3',
    db_server_type: 'mariadb',
    db_server_version: '11.4.2',
    versions_last_checked_at: '2026-11-01T10:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  };
  const component = (overrides) => ({
    component_type_slug: 'wordpress-plugin',
    version: '1.0.0',
    is_malware: false,
    has_vulnerabilities: false,
    is_patched: false,
    max_cvss_rating: null,
    ...overrides,
  });

  test('shows details and each component with its status', async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_COPY]);
    mockWebsite.findByDomain.mockResolvedValue(FULL_ROW);
    mockWebsiteComponent.getPlugins.mockResolvedValue([
      component({ slug: 'safe-plugin' }),
      component({ slug: 'bad-plugin', has_vulnerabilities: true, max_cvss_rating: 'high' }),
      component({ slug: 'fixed-plugin', has_vulnerabilities: true, is_patched: true, max_cvss_rating: 'medium' }),
      component({ slug: 'unrated-plugin', has_vulnerabilities: true }),
      component({ slug: 'evil-plugin', is_malware: true }),
    ]);
    mockWebsiteComponent.getThemes.mockResolvedValue([component({ slug: 'a-theme', component_type_slug: 'wordpress-theme' })]);

    const result = await runCli(['website:show', 'one.example.com']);

    expect(result.exitCode).toBe(0);
    expect(mockWebsite.findByDomain).toHaveBeenCalledWith('one.example.com', 5);
    expect(result.stdout).toMatch(/Owner:\s+alice@example\.com/);
    expect(result.stdout).toMatch(/WordPress:\s+6\.8\.1/);
    expect(result.stdout).toMatch(/Database:\s+mariadb 11\.4\.2/);
    expect(result.stdout).toMatch(/Last report:\s+2026-11-01 10:00:00/);
    expect(result.stdout).toMatch(/safe-plugin\s+1\.0\.0\s+ok/);
    expect(result.stdout).toMatch(/bad-plugin\s+1\.0\.0\s+VULNERABLE \(high\)/);
    expect(result.stdout).toMatch(/fixed-plugin\s+1\.0\.0\s+vulnerable \(patched\)/);
    expect(result.stdout).toMatch(/unrated-plugin\s+1\.0\.0\s+VULNERABLE \(unrated\)/);
    expect(result.stdout).toMatch(/evil-plugin\s+1\.0\.0\s+MALWARE/);
    expect(result.stdout).toMatch(/wordpress-theme\s+a-theme/);
    expect(result.stdout).toMatch(/6 components, 3 vulnerable, 1 malware\./);
  });

  test("shows every account's copy of a shared domain unless --owner narrows it", async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_COPY, BOB_COPY]);
    mockWebsite.findByDomain.mockImplementation(async (domain, userId) => ({ ...FULL_ROW, id: userId === 5 ? 11 : 12, user_id: userId }));
    mockWebsiteComponent.getPlugins.mockResolvedValue([]);
    mockWebsiteComponent.getThemes.mockResolvedValue([]);

    const both = await runCli(['website:show', 'one.example.com']);
    expect(both.exitCode).toBe(0);
    expect(both.stdout).toMatch(/registered by 2 accounts/);
    expect(both.stdout).toMatch(/Owner:\s+alice@example\.com/);
    expect(both.stdout).toMatch(/Owner:\s+bob@example\.com/);
    expect(both.stdout).toMatch(/No components recorded/);

    const narrowed = await runCli(['website:show', 'one.example.com', '--owner', 'bob@example.com', '--json']);
    const parsed = JSON.parse(narrowed.stdout);
    expect(narrowed.exitCode).toBe(0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: 12, owner: 'bob@example.com', is_ssl: true, components: [] });
  });

  test('exits 1 when the domain is not found', async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([]);

    const result = await runCli(['website:show', 'missing.example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/'missing\.example\.com' not found/);
  });

  test('exits 1 when --owner matches no copy', async () => {
    mockWebsite.findAllByDomain.mockResolvedValue([ALICE_COPY]);

    const result = await runCli(['website:show', 'one.example.com', '--owner', 'carol@example.com']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not owned by carol@example\.com \(owners: alice@example\.com\)/);
    expect(mockWebsite.findByDomain).not.toHaveBeenCalled();
  });
});
