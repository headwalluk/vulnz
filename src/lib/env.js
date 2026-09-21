// Helpers and normalization for environment variables
const fs = require('fs');
const path = require('path');

const ENV_FILE_PATH = path.join(__dirname, '../../.env');
const ENV_EXAMPLE_PATH = path.join(__dirname, '../../.env.example');
const REQUIRED_DATABASE_VARS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
// Placeholder values shipped in .env.example; the repo is public, so none of them is a secret.
const EXAMPLE_PLACEHOLDER_PATTERNS = [/^YOUR_[A-Z_]+_HERE$/, /^CHANGE_ME/];
const NOTIFY_SECRET_VAR = 'VULNZ_NOTIFY_SECRET';
const WHOLE_NUMBER_PATTERN = /^\d+$/;
const PASSWORD_POLICY_SETTINGS = [
  { name: 'PASSWORD_MIN_LENGTH', key: 'minLength', min: 1 },
  { name: 'PASSWORD_MIN_ALPHA', key: 'minAlpha', min: 0 },
  { name: 'PASSWORD_MIN_SYMBOLS', key: 'minSymbols', min: 0 },
  { name: 'PASSWORD_MIN_NUMERIC', key: 'minNumeric', min: 0 },
  { name: 'PASSWORD_MIN_UPPERCASE', key: 'minUppercase', min: 0 },
  { name: 'PASSWORD_MIN_LOWERCASE', key: 'minLowercase', min: 0 },
];
const BANNER_RULE = '═'.repeat(63);

const TRUE_SET = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSE_SET = new Set(['0', 'false', 'no', 'n', 'off']);

function parseBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return !!defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (TRUE_SET.has(v)) return true;
  if (FALSE_SET.has(v)) return false;
  return !!defaultValue;
}

function parseIntEnv(name, { min, max, default: defVal } = {}) {
  const raw = process.env[name];
  let n = parseInt(String(raw ?? '').trim(), 10);
  if (Number.isNaN(n)) n = defVal;
  if (typeof n !== 'number' || Number.isNaN(n)) return defVal;
  if (typeof min === 'number' && n < min) n = min;
  if (typeof max === 'number' && n > max) n = max;
  return n;
}

function parseEnum(name, allowed, defaultValue) {
  const raw = (process.env[name] || '').toString().toLowerCase();
  const set = new Set(allowed.map((s) => s.toLowerCase()));
  return set.has(raw) ? raw : defaultValue;
}

// Read a free-form string env var, trimmed, falling back to a default
// when unset or blank. For URLs, user agents, endpoints and similar
// non-enumerated string configuration.
function parseStr(name, defaultValue = '') {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  const trimmed = String(raw).trim();
  return trimmed === '' ? defaultValue : trimmed;
}

/** Whether a value is one of the placeholders shipped in .env.example. */
function isExamplePlaceholder(value) {
  return EXAMPLE_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/** Problems with the password policy settings: each must be a whole number at or above its minimum. */
function findPasswordPolicyProblems() {
  const problems = [];
  for (const setting of PASSWORD_POLICY_SETTINGS) {
    const value = String(process.env[setting.name] ?? '').trim();
    if (value === '') {
      problems.push(`${setting.name} is not set.`);
    } else if (!WHOLE_NUMBER_PATTERN.test(value) || Number(value) < setting.min) {
      problems.push(`${setting.name} must be a whole number of at least ${setting.min} (got "${value}").`);
    }
  }
  return problems;
}

/** Problems with the settings VULNZ must not run without, read from the loaded environment. */
function findCriticalSettingProblems() {
  const problems = [];
  for (const name of REQUIRED_DATABASE_VARS) {
    const value = String(process.env[name] ?? '').trim();
    if (value === '') {
      problems.push(`${name} is not set.`);
    } else if (isExamplePlaceholder(value)) {
      problems.push(`${name} still has its placeholder value from .env.example (${value}).`);
    }
  }
  problems.push(...findPasswordPolicyProblems());
  // Optional (unset keeps the notification endpoints closed), but the example value is public.
  const notifySecret = String(process.env[NOTIFY_SECRET_VAR] ?? '').trim();
  if (notifySecret !== '' && isExamplePlaceholder(notifySecret)) {
    problems.push(`${NOTIFY_SECRET_VAR} still has its placeholder value from .env.example. Generate one with: openssl rand -hex 32`);
  }
  return problems;
}

/**
 * Load .env from the project root, exiting with every problem listed if it is missing or
 * any critical setting is unset or malformed. Call before anything reads the environment.
 *
 * @param {{envFilePath?: string, examplePath?: string}} [options] paths, overridable for tests
 */
function loadEnvFile({ envFilePath = ENV_FILE_PATH, examplePath = ENV_EXAMPLE_PATH } = {}) {
  const fileExists = fs.existsSync(envFilePath);
  let problems = [`${envFilePath} does not exist.`];
  let instructions = [
    '  To set it up:',
    '',
    `    cp ${examplePath} ${envFilePath}`,
    `    chmod 600 ${envFilePath}`,
    '',
    `  Then edit ${envFilePath} and set the database credentials:`,
    `    ${REQUIRED_DATABASE_VARS.join(', ')}`,
  ];
  if (fileExists) {
    // dotenv never overrides a variable already set in the real environment.
    require('dotenv').config({ path: envFilePath, quiet: true });
    problems = findCriticalSettingProblems();
    instructions = [`  Edit ${envFilePath} and fix the settings above.`, `  ${examplePath} documents each one.`];
  }

  if (problems.length > 0) {
    const lines = [
      '',
      BANNER_RULE,
      'VULNZ cannot start: the environment is not configured.',
      BANNER_RULE,
      '',
      ...problems.map((problem) => `  - ${problem}`),
      '',
      ...instructions,
      '',
      '  See docs/installation.md for the other settings.',
      '',
      BANNER_RULE,
      '',
    ];
    console.error(lines.join('\n'));
    process.exit(1);
  }
}

/**
 * The password policy, parsed from the environment.
 *
 * @returns {{minLength: number, minAlpha: number, minSymbols: number, minNumeric: number, minUppercase: number, minLowercase: number}}
 * @throws {Error} if any setting is unset or malformed; loadEnvFile() refuses to start in that case
 */
function getPasswordPolicy() {
  const problems = findPasswordPolicyProblems();
  if (problems.length > 0) {
    throw new Error(`Password policy is not configured: ${problems.join(' ')}`);
  }
  return Object.fromEntries(PASSWORD_POLICY_SETTINGS.map((setting) => [setting.key, Number(String(process.env[setting.name]).trim())]));
}

// Normalize environment variables to safe, predictable values at startup
function normalizeEnv() {
  // NODE_ENV normalization: only 'development' or 'production' (default 'development')
  const envValid = new Set(['development', 'production']);
  const rawEnv = (process.env.NODE_ENV || '').toLowerCase();
  if (!envValid.has(rawEnv)) {
    const msg = rawEnv ? `Invalid NODE_ENV "${rawEnv}" detected; defaulting to "development".` : 'NODE_ENV not set; defaulting to "development".';
    console.warn(msg);
    process.env.NODE_ENV = 'development';
  } else {
    process.env.NODE_ENV = rawEnv; // normalize casing
  }

  // Boolean-like vars normalization: coerce to literal strings 'true' or 'false'
  const boolVars = [{ name: 'CRON_ENABLE', defaultValue: false }];

  for (const { name, defaultValue } of boolVars) {
    const raw = process.env[name];
    const normalized = parseBool(name, defaultValue);
    if (raw == null || String(raw).trim() === '') {
      process.env[name] = normalized ? 'true' : 'false';
    } else {
      const v = String(raw).trim().toLowerCase();
      if (!TRUE_SET.has(v) && !FALSE_SET.has(v)) {
        console.warn(`Invalid ${name} value "${raw}"; defaulting to "${defaultValue ? 'true' : 'false'}".`);
      }
      process.env[name] = normalized ? 'true' : 'false';
    }
  }

  // NODE_APP_INSTANCE normalization: non-negative integer string (default '0')
  // Useful for PM2 clusters; also safe in single-process mode.
  const rawInst = process.env.NODE_APP_INSTANCE;
  const parsed = parseInt(String(rawInst ?? '').trim(), 10);
  const inst = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  process.env.NODE_APP_INSTANCE = String(inst);

  // LIST_PAGE_SIZE normalization: integer >= 1, default 10
  const lps = parseIntEnv('LIST_PAGE_SIZE', { min: 1, default: 10 });
  if (String(lps) !== String(process.env.LIST_PAGE_SIZE)) {
    const raw = process.env.LIST_PAGE_SIZE;
    if (raw == null || Number.isNaN(parseInt(String(raw), 10)) || parseInt(String(raw), 10) < 1) {
      console.warn('Invalid LIST_PAGE_SIZE; defaulting to 10 (min 1).');
    }
  }
  process.env.LIST_PAGE_SIZE = String(lps);

  // API_MAX_PAGE_SIZE normalization: integer >= 1, default 200.
  // Upper bound on ?limit= for list endpoints. Not a database concern —
  // response payload is what grows, and an agent pulling the whole fleet
  // costs far more in tokens than in query time.
  const maxPage = parseIntEnv('API_MAX_PAGE_SIZE', { min: 1, default: 200 });
  const rawMaxPage = process.env.API_MAX_PAGE_SIZE;
  if (rawMaxPage != null && String(maxPage) !== String(rawMaxPage)) {
    console.warn('Invalid API_MAX_PAGE_SIZE; defaulting to 200 (min 1).');
  }
  process.env.API_MAX_PAGE_SIZE = String(maxPage);

  // LOG_LEVEL normalization: enum 'debug'|'info'|'warn'|'error', default 'info'
  const allowedLevels = ['debug', 'info', 'warn', 'error'];
  const rawLevel = (process.env.LOG_LEVEL || '').toLowerCase();
  const level = parseEnum('LOG_LEVEL', allowedLevels, 'info');
  if (!new Set(allowedLevels).has(rawLevel)) {
    if (rawLevel) console.warn(`Invalid LOG_LEVEL "${rawLevel}"; defaulting to "info".`);
  }
  process.env.LOG_LEVEL = level;

  // UNAUTH_SEARCH_LIMIT_PER_SECOND normalization: integer >= 0, default 1
  // 0 disables unauthenticated rate-limiting entirely
  const uslps = parseIntEnv('UNAUTH_SEARCH_LIMIT_PER_SECOND', { min: 0, default: 1 });
  if (String(uslps) !== String(process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND)) {
    const raw = process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND;
    const parsedRaw = parseInt(String(raw ?? ''), 10);
    if (raw == null || Number.isNaN(parsedRaw) || parsedRaw < 0) {
      console.warn('Invalid UNAUTH_SEARCH_LIMIT_PER_SECOND; defaulting to 1 (min 0, 0 disables).');
    }
  }
  process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND = String(uslps);

  // UNAUTH_SEARCH_WINDOW_SECONDS normalization: integer >= 1, default 10.
  // The window over which the per-second limit is counted. A longer window
  // absorbs the burst of requests a search-as-you-type box produces without
  // raising the sustained rate.
  process.env.UNAUTH_SEARCH_WINDOW_SECONDS = String(parseIntEnv('UNAUTH_SEARCH_WINDOW_SECONDS', { min: 1, default: 10 }));

  // Additional environment variable normalizations...
  process.env.EMAIL_LOG_MAX_AGE_DAYS = String(parseIntEnv('EMAIL_LOG_MAX_AGE_DAYS', { min: 0, default: 14 }));

  // MALWARE_ALERT_ENABLED normalization: off unless explicitly enabled, so
  // the feature ships inert and cannot start mailing on an upgrade alone.
  process.env.MALWARE_ALERT_ENABLED = parseBool('MALWARE_ALERT_ENABLED', false) ? 'true' : 'false';

  // Warn early rather than at detection time — the alert is the one email
  // that must not be silently dropped.
  if (process.env.MALWARE_ALERT_ENABLED === 'true' && parseStr('MALWARE_ALERT_EMAIL', '') === '') {
    console.warn('MALWARE_ALERT_ENABLED is true but MALWARE_ALERT_EMAIL is not set; malware alerts will not be sent.');
  }
}

/**
 * Check that the .env file has secure permissions (0600).
 * This prevents other users on the system from reading secrets.
 * Can be skipped by setting SKIP_STARTUP_FILEMODE_CHECKS=true
 */
function checkEnvFilePermissions() {
  // Allow skipping this check if explicitly requested
  if (parseBool('SKIP_STARTUP_FILEMODE_CHECKS', false)) {
    return;
  }

  const envPath = ENV_FILE_PATH;

  // loadEnvFile() has already refused to start without it; nothing to check.
  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    const stats = fs.statSync(envPath);
    const mode = stats.mode & 0o777; // Get permission bits

    // Check if file is 0600 (owner read/write only)
    if (mode !== 0o600) {
      const octalMode = mode.toString(8);
      console.error('');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('⚠️  SECURITY WARNING: .env file has insecure permissions!');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('');
      console.error(`  Current permissions: 0${octalMode}`);
      console.error('  Required permissions: 0600 (owner read/write only)');
      console.error('');
      console.error('  The .env file contains sensitive secrets that should not be');
      console.error('  readable by other users on the system.');
      console.error('');
      console.error('  To fix this, run:');
      console.error(`    chmod 0600 ${envPath}`);
      console.error('');
      console.error('  To skip this check (NOT RECOMMENDED), set:');
      console.error('    SKIP_STARTUP_FILEMODE_CHECKS=true');
      console.error('');
      console.error('═══════════════════════════════════════════════════════════════');
      console.error('');

      // Exit with error code to prevent startup
      process.exit(1);
    }
  } catch (err) {
    // If we can't read the file stats, warn but don't fail
    console.warn(`Warning: Could not check .env file permissions: ${err.message}`);
  }
}

module.exports = { loadEnvFile, getPasswordPolicy, normalizeEnv, checkEnvFilePermissions, parseBool, parseIntEnv, parseEnum, parseStr };
