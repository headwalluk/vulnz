// Helpers and normalization for environment variables
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
  const boolVars = [
    { name: 'SETUP_MODE', defaultValue: false },
    { name: 'REGISTRATION_ENABLED', defaultValue: true },
    { name: 'CRON_ENABLE', defaultValue: false },
  ];

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
}

module.exports = { normalizeEnv, parseBool, parseIntEnv, parseEnum };
