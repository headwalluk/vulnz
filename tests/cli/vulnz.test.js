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

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/models/user', () => mockUser);

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
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`CLI did not call process.exit within 5 s for args: ${args.join(' ')}`)),
            5000
          )
        ),
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
