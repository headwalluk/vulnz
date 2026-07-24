/**
 * Urgent update classification tests (M13)
 *
 * Covers the LLM client (config gating, JSON extraction, retries, validation)
 * and the urgency layer built on it (keyword override, queue drain).
 *
 * No test makes a network call — fetch is injected throughout.
 */

const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const { runTask, extractJson, llmConfig } = require('../../src/lib/llm/client');
const { getTask, listTasks } = require('../../src/lib/llm/tasks');
const { classifyRelease, classifyPendingReleases, countPendingReleases, hasUrgentKeyword } = require('../../src/lib/urgency');
const releaseUrgency = require('../../src/lib/llm/tasks/releaseUrgency');

const ROUTINE_CHANGELOG = '<h4>1.2.0</h4><ul><li>Adds a settings screen.</li><li>Updates translations.</li></ul>';
const URGENT_CHANGELOG = '<h4>2.0.1</h4><ul><li>Fix - unauthenticated SQL injection in the search endpoint.</li></ul>';

/**
 * Build a fetch stub returning one chat-completion body.
 */
function mockCompletion(content, { status = 200 } = {}) {
  return jest.fn().mockResolvedValue({
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => 'error body',
  });
}

describe('LLM client', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LLM_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5';
    process.env.LLM_MAX_ATTEMPTS = '2';
    delete process.env.OPENROUTER_MODEL_RELEASE_URGENCY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('extractJson handles bare JSON, fenced JSON, and surrounding prose', () => {
    expect(extractJson('{"is_urgent":true,"summary":"x"}')).toEqual({ is_urgent: true, summary: 'x' });
    expect(extractJson('```json\n{"is_urgent":false,"summary":"y"}\n```')).toEqual({ is_urgent: false, summary: 'y' });
    expect(extractJson('Here you go: {"is_urgent":false,"summary":"z"} — hope that helps')).toEqual({ is_urgent: false, summary: 'z' });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('')).toBeNull();
  });

  test('is disabled unless both the flag and an API key are present', async () => {
    process.env.LLM_ENABLED = 'false';
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"x"}');

    const disabled = await runTask('release-urgency', { slug: 'a', version: '1.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });
    expect(disabled.ok).toBe(false);
    expect(disabled.error).toMatch(/disabled/i);
    expect(fetchImpl).not.toHaveBeenCalled();

    process.env.LLM_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = '';
    const keyless = await runTask('release-urgency', { slug: 'a', version: '1.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });
    expect(keyless.ok).toBe(false);
    expect(keyless.error).toMatch(/API key/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends the configured model and returns the validated result', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"Adds a settings screen."}');

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ is_urgent: false, summary: 'Adds a settings screen.' });
    expect(outcome.model).toBe('anthropic/claude-haiku-4.5');

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-key');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('anthropic/claude-haiku-4.5');
    expect(body.messages[1].content).toContain('Plugin: demo');
    expect(body.messages[1].content).toContain('Version: 1.2.0');
    // Changelog reaches the model as readable plain text, not HTML.
    expect(body.messages[1].content).toContain('- Adds a settings screen.');
    expect(body.messages[1].content).not.toContain('<li>');
  });

  test('honours a per-task model override', async () => {
    process.env.OPENROUTER_MODEL_RELEASE_URGENCY = 'anthropic/claude-opus-5';
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"ok"}');

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(outcome.model).toBe('anthropic/claude-opus-5');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('anthropic/claude-opus-5');
  });

  test('retries a 429 and succeeds on the second attempt', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ status: 429, text: async () => 'rate limited', json: async () => ({}) })
      .mockResolvedValueOnce({ status: 200, json: async () => ({ choices: [{ message: { content: '{"is_urgent":false,"summary":"ok"}' } }] }), text: async () => '' });

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(outcome.ok).toBe(true);
  });

  test('does not retry a 401 and reports the failure', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ status: 401, text: async () => 'unauthorized', json: async () => ({}) });

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/401/);
  });

  test('rejects a response missing required fields', async () => {
    const fetchImpl = mockCompletion('{"summary":"no verdict field"}');

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/is_urgent/);
  });

  test('reports a prompt-building failure for an empty changelog', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"ok"}');

    const outcome = await runTask('release-urgency', { slug: 'demo', version: '1.2.0', changelog: '   ' }, { fetchImpl });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/prompt/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('throws for an unregistered task slug', async () => {
    await expect(runTask('does-not-exist', {})).rejects.toThrow(/Unknown LLM task/);
  });

  test('exposes its default configuration', () => {
    delete process.env.OPENROUTER_BASE_URL;
    expect(llmConfig().baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});

describe('task registry', () => {
  test('resolves the release-urgency task and lists it', () => {
    expect(getTask('release-urgency')).toBeDefined();
    expect(getTask('nope')).toBeUndefined();
    expect(listTasks().map((task) => task.slug)).toContain('release-urgency');
  });

  test('changelogToText flattens HTML into one change per line', () => {
    const text = releaseUrgency.changelogToText('<h4>1.0</h4><ul><li>First fix</li><li>Second fix</li></ul>');
    expect(text.split('\n')).toEqual(['1.0', '- First fix', '- Second fix']);
  });

  test('parseResult truncates an overlong summary', () => {
    const long = 'x'.repeat(400);
    expect(releaseUrgency.parseResult({ is_urgent: false, summary: long }).summary).toHaveLength(240);
  });
});

describe('urgency classification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LLM_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('hasUrgentKeyword matches critical phrases case-insensitively', () => {
    expect(hasUrgentKeyword('Fixed a SQL Injection in the admin')).toBe(true);
    expect(hasUrgentKeyword('Remote Code Execution patched')).toBe(true);
    expect(hasUrgentKeyword('Updated dependencies with security advisories')).toBe(false);
    expect(hasUrgentKeyword('')).toBe(false);
  });

  test('keeps the model verdict when nothing overrides it', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"Adds a settings screen."}');

    const outcome = await classifyRelease({ slug: 'demo', version: '1.2.0', changelog: ROUTINE_CHANGELOG }, { fetchImpl });

    expect(outcome.ok).toBe(true);
    expect(outcome.verdict).toEqual({
      is_urgent: false,
      summary: 'Adds a settings screen.',
      source: 'changelog_llm',
    });
  });

  test('keyword override raises a release the model called routine', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":false,"summary":"Minor fixes."}');

    const outcome = await classifyRelease({ slug: 'demo', version: '2.0.1', changelog: URGENT_CHANGELOG }, { fetchImpl });

    expect(outcome.verdict.is_urgent).toBe(true);
    expect(outcome.verdict.source).toBe('keyword_override');
  });

  test('keyword override does not relabel a release the model already called urgent', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":true,"summary":"Fixes an unauthenticated SQL injection."}');

    const outcome = await classifyRelease({ slug: 'demo', version: '2.0.1', changelog: URGENT_CHANGELOG }, { fetchImpl });

    expect(outcome.verdict.is_urgent).toBe(true);
    expect(outcome.verdict.source).toBe('changelog_llm');
    expect(outcome.verdict.summary).toBe('Fixes an unauthenticated SQL injection.');
  });
});

describe('pending classification queue', () => {
  let db;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug, latest_version) VALUES (?, ?, ?, ?, ?)', [
      'watched',
      'wordpress-plugin',
      'Watched',
      'high',
      '2.0.1',
    ]);
    await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug, latest_version) VALUES (?, ?, ?, ?, ?)', [
      'background',
      'wordpress-plugin',
      'Background',
      'low',
      '1.0.0',
    ]);

    const watched = await db.query('SELECT id FROM components WHERE slug = ?', ['watched']);
    const background = await db.query('SELECT id FROM components WHERE slug = ?', ['background']);

    await db.query('INSERT INTO releases (component_id, version, changelog) VALUES (?, ?, ?)', [watched[0].id, '2.0.1', URGENT_CHANGELOG]);
    // Low-priority: must never be classified — the fast lane is the only lane
    // that feeds the manifest.
    await db.query('INSERT INTO releases (component_id, version, changelog) VALUES (?, ?, ?)', [background[0].id, '1.0.0', ROUTINE_CHANGELOG]);
    // High-priority but no changelog captured: not classifiable.
    await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [watched[0].id, '2.0.0']);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(() => {
    process.env.LLM_ENABLED = 'true';
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('counts only high-priority releases holding a changelog', async () => {
    expect(await countPendingReleases()).toBe(1);
  });

  test('skips cleanly when the LLM is disabled', async () => {
    process.env.LLM_ENABLED = 'false';

    const summary = await classifyPendingReleases({ fetchImpl: mockCompletion('{}') });

    expect(summary.skipped).toBe(true);
    expect(summary.classified).toBe(0);
    expect(await countPendingReleases()).toBe(1);
  });

  test('classifies the queue and persists the verdict', async () => {
    const fetchImpl = mockCompletion('{"is_urgent":true,"summary":"Fixes an unauthenticated SQL injection."}');

    const summary = await classifyPendingReleases({ fetchImpl });

    expect(summary.classified).toBe(1);
    expect(summary.urgent).toBe(1);
    expect(summary.failed).toBe(0);

    const rows = await db.query('SELECT is_urgent, urgency_summary, urgency_source_slug, urgency_checked_at FROM releases WHERE version = ?', ['2.0.1']);
    expect(rows[0].is_urgent).toBe(1);
    expect(rows[0].urgency_summary).toBe('Fixes an unauthenticated SQL injection.');
    expect(rows[0].urgency_source_slug).toBe('changelog_llm');
    expect(rows[0].urgency_checked_at).toBeTruthy();

    // Queue is now empty, and the low-priority release was never touched.
    expect(await countPendingReleases()).toBe(0);
    const background = await db.query('SELECT urgency_checked_at FROM releases WHERE version = ?', ['1.0.0']);
    expect(background[0].urgency_checked_at).toBeNull();
  });

  test('leaves a release pending when classification fails', async () => {
    const watched = await db.query('SELECT id FROM components WHERE slug = ?', ['watched']);
    await db.query('INSERT INTO releases (component_id, version, changelog) VALUES (?, ?, ?)', [watched[0].id, '2.0.2', ROUTINE_CHANGELOG]);

    const fetchImpl = jest.fn().mockResolvedValue({ status: 500, text: async () => 'boom', json: async () => ({}) });
    const summary = await classifyPendingReleases({ fetchImpl });

    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(1);

    // Still queued, so the next run retries it.
    expect(await countPendingReleases()).toBe(1);
  });
});
