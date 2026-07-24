const { parseBool, parseIntEnv, parseStr, parseEnum } = require('../env');
const { getTask } = require('./tasks');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const DEFAULT_MAX_ATTEMPTS = 2;
const MIN_MAX_ATTEMPTS = 1;
const MAX_MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;
const CHAT_COMPLETIONS_PATH = '/chat/completions';

// HTTP statuses worth a second attempt: rate limiting and server-side faults.
// Anything else (401, 400, 404) is a configuration problem that retrying
// cannot fix.
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve LLM configuration from the environment. All values normalised via
 * src/lib/env.js rather than raw process.env.
 *
 * The provider is OpenRouter, which speaks the OpenAI chat-completions shape.
 * Keeping every provider-specific detail inside this module means switching
 * provider later is a change to one file, not to every call site.
 */
function llmConfig() {
  return {
    enabled: parseBool('LLM_ENABLED', false),
    apiKey: parseStr('OPENROUTER_API_KEY', ''),
    baseUrl: parseStr('OPENROUTER_BASE_URL', DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: parseStr('OPENROUTER_MODEL', DEFAULT_MODEL),
    timeoutMs: parseIntEnv('LLM_TIMEOUT_MS', { min: MIN_TIMEOUT_MS, default: DEFAULT_TIMEOUT_MS }),
    maxAttempts: parseIntEnv('LLM_MAX_ATTEMPTS', { min: MIN_MAX_ATTEMPTS, max: MAX_MAX_ATTEMPTS, default: DEFAULT_MAX_ATTEMPTS }),
    // Optional OpenRouter attribution headers — they appear on the provider's
    // dashboard and are not required for the request to succeed.
    referer: parseStr('OPENROUTER_SITE_URL', ''),
    title: parseStr('OPENROUTER_SITE_NAME', ''),
  };
}

/**
 * Is the LLM layer usable? Enabled and holding an API key. Callers use this
 * to skip work cleanly rather than accumulate failed attempts.
 */
function isLlmAvailable() {
  const config = llmConfig();
  return config.enabled && config.apiKey !== '';
}

function isDebugLogging() {
  const level = parseEnum('LOG_LEVEL', ['debug', 'info', 'warn', 'error'], 'info');
  return level === 'debug' || level === 'info';
}

/**
 * Pull JSON out of a model response. Models frequently wrap JSON in markdown
 * fences or add a sentence either side of it, so a bare JSON.parse() is too
 * brittle to rely on across the range of models this may be pointed at.
 * @returns {object|null} the parsed object, or null if nothing parseable
 */
function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }

  const candidates = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    candidates.push(fenced[1].trim());
  }

  // Fall back to the outermost brace pair.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.substring(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

/**
 * Which model should a given task use? A task may nominate its own env var so
 * an expensive or unusually demanding task can be pointed at a stronger model
 * without moving everything else.
 */
function resolveModel(task, config) {
  if (task.modelEnvVar) {
    const override = parseStr(task.modelEnvVar, '');
    if (override) {
      return override;
    }
  }
  return config.model;
}

/**
 * Issue one chat-completion request.
 * @returns {Promise<{ok:boolean, content:string|null, status:number|null, retryable:boolean, error:string|null}>}
 */
async function requestCompletion({ fetch, config, model, task, userPrompt }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.referer) {
    headers['HTTP-Referer'] = config.referer;
  }
  if (config.title) {
    headers['X-Title'] = config.title;
  }

  const body = {
    model,
    max_tokens: task.maxTokens,
    messages: [
      { role: 'system', content: task.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  try {
    const response = await fetch(`${config.baseUrl}${CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.status !== 200) {
      let detail = '';
      try {
        detail = (await response.text()).substring(0, 500);
      } catch {
        detail = '';
      }
      return {
        ok: false,
        content: null,
        status: response.status,
        retryable: RETRYABLE_STATUSES.has(response.status),
        error: `Provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    const data = await response.json();
    const content = data && Array.isArray(data.choices) && data.choices.length > 0 && data.choices[0].message ? data.choices[0].message.content : null;

    if (typeof content !== 'string' || content.trim() === '') {
      return { ok: false, content: null, status: 200, retryable: false, error: 'Provider returned an empty completion.' };
    }

    return { ok: true, content, status: 200, retryable: false, error: null };
  } catch (err) {
    // AbortError (timeout) and network failures are both worth one retry.
    const reason = err && err.name === 'AbortError' ? `Request timed out after ${config.timeoutMs}ms` : `Request failed: ${err.message}`;
    return { ok: false, content: null, status: null, retryable: true, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a named task from the registry against the configured provider.
 *
 * Never throws for provider, network, or parsing problems — those come back
 * as `{ ok: false, error }` so callers can degrade rather than break. The one
 * exception is an unknown task slug, which is a programming error.
 *
 * @param {string} taskSlug registry key, e.g. 'release-urgency'
 * @param {object} input task-specific input, passed to buildUserPrompt()
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] injected fetch, for tests
 * @returns {Promise<{ok:boolean, result:object|null, model:string|null, error:string|null}>}
 */
async function runTask(taskSlug, input, { fetchImpl } = {}) {
  const task = getTask(taskSlug);
  if (!task) {
    throw new Error(`Unknown LLM task: ${taskSlug}`);
  }

  const config = llmConfig();

  if (!config.enabled) {
    return { ok: false, result: null, model: null, error: 'LLM support is disabled (LLM_ENABLED).' };
  }
  if (!config.apiKey) {
    return { ok: false, result: null, model: null, error: 'No provider API key configured (OPENROUTER_API_KEY).' };
  }

  const fetch = fetchImpl || (await import('node-fetch')).default;
  const model = resolveModel(task, config);

  let userPrompt;
  try {
    userPrompt = task.buildUserPrompt(input);
  } catch (err) {
    return { ok: false, result: null, model, error: `Could not build prompt: ${err.message}` };
  }

  let lastError = 'No attempt was made.';

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    if (isDebugLogging() && attempt > 1) {
      console.log(`LLM task ${taskSlug}: retry ${attempt} of ${config.maxAttempts}`);
    }

    const outcome = await requestCompletion({ fetch, config, model, task, userPrompt });

    if (outcome.ok) {
      const parsed = extractJson(outcome.content);
      if (!parsed) {
        lastError = 'Provider response was not valid JSON.';
        // A malformed response can be a one-off; allow the retry loop to run.
        if (attempt < config.maxAttempts) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }

      try {
        const result = task.parseResult(parsed);
        return { ok: true, result, model, error: null };
      } catch (err) {
        lastError = `Provider response failed validation: ${err.message}`;
        break;
      }
    }

    lastError = outcome.error;
    if (!outcome.retryable || attempt >= config.maxAttempts) {
      break;
    }
    await sleep(RETRY_DELAY_MS);
  }

  return { ok: false, result: null, model, error: lastError };
}

module.exports = {
  llmConfig,
  isLlmAvailable,
  runTask,
  extractJson,
};
