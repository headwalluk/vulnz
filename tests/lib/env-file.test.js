/**
 * Missing or incomplete .env fails loud
 *
 * loadEnvFile() must refuse to start, listing every problem at once and saying
 * exactly what to do, rather than letting the app run on undefined or
 * malformed critical settings.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile, getPasswordPolicy } = require('../../src/lib/env');
const { validatePassword } = require('../../src/lib/passwordValidation');

const DATABASE_SETTINGS = 'DB_HOST=localhost\nDB_USER=vulnz\nDB_PASSWORD=secret\nDB_NAME=vulnz\n';
const PASSWORD_SETTINGS = 'PASSWORD_MIN_LENGTH=8\nPASSWORD_MIN_ALPHA=1\nPASSWORD_MIN_SYMBOLS=1\nPASSWORD_MIN_NUMERIC=1\nPASSWORD_MIN_UPPERCASE=1\nPASSWORD_MIN_LOWERCASE=1\n';
const CRITICAL_VARS = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'PASSWORD_MIN_LENGTH',
  'PASSWORD_MIN_ALPHA',
  'PASSWORD_MIN_SYMBOLS',
  'PASSWORD_MIN_NUMERIC',
  'PASSWORD_MIN_UPPERCASE',
  'PASSWORD_MIN_LOWERCASE',
  'VULNZ_NOTIFY_SECRET',
];

let tempDir;
let savedEnv;
let exitSpy;
let errorSpy;

/** Run loadEnvFile against a temp .env, returning the exit code (or null) and what it printed. */
function run(envFileContent) {
  const envFilePath = path.join(tempDir, '.env');
  if (envFileContent !== null) {
    fs.writeFileSync(envFilePath, envFileContent);
  }
  loadEnvFile({ envFilePath, examplePath: path.join(tempDir, '.env.example') });
  const exitCode = exitSpy.mock.calls.length > 0 ? exitSpy.mock.calls[0][0] : null;
  return { exitCode, output: errorSpy.mock.calls.map((call) => call.join(' ')).join('\n'), envFilePath };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vulnz-env-'));
  savedEnv = Object.fromEntries(CRITICAL_VARS.map((name) => [name, process.env[name]]));
  // jest.setup.js sets these; clear them so only the file under test counts.
  for (const name of CRITICAL_VARS) {
    delete process.env[name];
  }
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('loadEnvFile', () => {
  test('exits with the copy, chmod and edit instructions when .env is missing', () => {
    const { exitCode, output, envFilePath } = run(null);

    expect(exitCode).toBe(1);
    expect(output).toContain(`${envFilePath} does not exist.`);
    expect(output).toContain(`cp ${path.join(tempDir, '.env.example')} ${envFilePath}`);
    expect(output).toContain(`chmod 600 ${envFilePath}`);
    expect(output).toContain('DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
  });

  test('lists every missing, placeholder and malformed critical setting at once', () => {
    const { exitCode, output, envFilePath } = run(
      "DB_HOST=localhost\nDB_USER='YOUR_DB_USER_HERE'\nDB_PASSWORD=\n" +
        'PASSWORD_MIN_LENGTH=0\nPASSWORD_MIN_ALPHA=one\nPASSWORD_MIN_SYMBOLS=1\nPASSWORD_MIN_NUMERIC=-1\nPASSWORD_MIN_UPPERCASE=1\n' +
        'VULNZ_NOTIFY_SECRET=CHANGE_ME_TO_A_RANDOM_SECRET\n'
    );

    expect(exitCode).toBe(1);
    expect(output).toContain('DB_USER still has its placeholder value from .env.example (YOUR_DB_USER_HERE).');
    expect(output).toContain('DB_PASSWORD is not set.');
    expect(output).toContain('DB_NAME is not set.');
    expect(output).toContain('PASSWORD_MIN_LENGTH must be a whole number of at least 1 (got "0").');
    expect(output).toContain('PASSWORD_MIN_ALPHA must be a whole number of at least 0 (got "one").');
    expect(output).toContain('PASSWORD_MIN_NUMERIC must be a whole number of at least 0 (got "-1").');
    expect(output).toContain('PASSWORD_MIN_LOWERCASE is not set.');
    expect(output).toContain('VULNZ_NOTIFY_SECRET still has its placeholder value');
    expect(output).not.toContain('- DB_HOST');
    expect(output).not.toContain('- PASSWORD_MIN_SYMBOLS');
    expect(output).toContain(`Edit ${envFilePath} and fix the settings above.`);
    expect(output).not.toContain('chmod 600');
  });

  test('loads a complete .env without exiting', () => {
    const { exitCode } = run(DATABASE_SETTINGS + PASSWORD_SETTINGS + 'VULNZ_NOTIFY_SECRET=0123456789abcdef\n');

    expect(exitCode).toBeNull();
    expect(process.env.DB_NAME).toBe('vulnz');
  });

  test('allows VULNZ_NOTIFY_SECRET to be unset, which keeps the notification endpoints closed', () => {
    const { exitCode } = run(DATABASE_SETTINGS + PASSWORD_SETTINGS);

    expect(exitCode).toBeNull();
  });

  test('accepts critical settings from the real environment when .env leaves them out', () => {
    process.env.DB_PASSWORD = 'from-the-environment';

    const { exitCode } = run('DB_HOST=localhost\nDB_USER=vulnz\nDB_NAME=vulnz\n' + PASSWORD_SETTINGS);

    expect(exitCode).toBeNull();
    expect(process.env.DB_PASSWORD).toBe('from-the-environment');
  });
});

describe('password policy', () => {
  test('getPasswordPolicy throws rather than returning no policy', () => {
    expect(() => getPasswordPolicy()).toThrow(/Password policy is not configured: PASSWORD_MIN_LENGTH is not set/);
  });

  test('validatePassword enforces the parsed policy', () => {
    run(DATABASE_SETTINGS + PASSWORD_SETTINGS);

    expect(getPasswordPolicy()).toEqual({ minLength: 8, minAlpha: 1, minSymbols: 1, minNumeric: 1, minUppercase: 1, minLowercase: 1 });
    expect(validatePassword('weak').isValid).toBe(false);
    expect(validatePassword('Str0ng!Passw0rd').isValid).toBe(true);
  });
});
