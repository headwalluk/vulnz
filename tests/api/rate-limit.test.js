/**
 * Unauthenticated search rate limiting
 *
 * The limiter reads its configuration once at module load, so each scenario
 * builds a fresh app inside jest.isolateModules with the env vars it needs.
 */

const request = require('supertest');
const express = require('express');

/**
 * Build a tiny app with the limiter in front of a trivial handler,
 * configured by the supplied env vars.
 *
 * @param {{limit?: string, window?: string, authenticated?: boolean}} options
 */
function buildApp({ limit, window: windowSeconds, authenticated = false } = {}) {
  const savedLimit = process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND;
  const savedWindow = process.env.UNAUTH_SEARCH_WINDOW_SECONDS;

  if (limit !== undefined) {
    process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND = limit;
  }
  if (windowSeconds !== undefined) {
    process.env.UNAUTH_SEARCH_WINDOW_SECONDS = windowSeconds;
  }

  let app;
  jest.isolateModules(() => {
    const { unauthenticatedSearchLimiter } = require('../../src/middleware/rateLimit');
    app = express();
    app.set('trust proxy', 1);

    // Stands in for optionalApiAuth, which runs before the limiter so that
    // skip() can see req.user.
    app.use((req, res, next) => {
      if (authenticated) {
        req.user = { id: 42 };
      }
      next();
    });

    app.get('/search', unauthenticatedSearchLimiter, (req, res) => res.json({ ok: true }));
  });

  process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND = savedLimit;
  process.env.UNAUTH_SEARCH_WINDOW_SECONDS = savedWindow;

  return app;
}

/** Fire n sequential requests from one simulated client address. */
async function fire(app, count, forwardedFor = '203.0.113.9') {
  const statuses = [];
  for (let index = 0; index < count; index++) {
    const response = await request(app).get('/search').set('X-Forwarded-For', forwardedFor);
    statuses.push(response.status);
  }
  return statuses;
}

describe('unauthenticated search rate limiting', () => {
  test('allows a typeahead burst within the window', async () => {
    // 1/sec over a 10s window = 10 requests available at once. Typing a slug
    // produces a handful of debounced requests in quick succession; that must
    // not 429, which is what a one-second window used to do.
    const app = buildApp({ limit: '1', window: '10' });

    const statuses = await fire(app, 8);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  test('rejects once the window budget is spent', async () => {
    const app = buildApp({ limit: '1', window: '2' });

    const statuses = await fire(app, 4);

    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429);
    expect(statuses[3]).toBe(429);
  });

  test('answers 429 with JSON a browser can act on', async () => {
    const app = buildApp({ limit: '1', window: '2' });
    await fire(app, 2);

    const response = await request(app).get('/search').set('X-Forwarded-For', '203.0.113.9');

    expect(response.status).toBe(429);
    expect(response.body.error).toBe('Too many requests');
    expect(response.body.retry_after_seconds).toBeGreaterThan(0);
    expect(response.headers['retry-after']).toBeDefined();
  });

  test('budgets are per client address', async () => {
    const app = buildApp({ limit: '1', window: '2' });

    await fire(app, 3, '203.0.113.9');
    const otherClient = await fire(app, 1, '198.51.100.7');

    expect(otherClient).toEqual([200]);
  });

  test('does not limit authenticated callers', async () => {
    // The limiter used to sit ahead of authentication, so req.user was never
    // set and every authenticated search was billed to the anonymous budget.
    const app = buildApp({ limit: '1', window: '2', authenticated: true });

    const statuses = await fire(app, 12);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  test('a limit of 0 disables limiting entirely', async () => {
    const app = buildApp({ limit: '0', window: '2' });

    const statuses = await fire(app, 12);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  test('keys on the proxy-derived client address, not the raw header', async () => {
    // X-Forwarded-For is client-supplied. With trust proxy set, Express takes
    // the last trusted hop, so appending fake entries must not mint a new
    // budget.
    const app = buildApp({ limit: '1', window: '2' });

    await fire(app, 2, '203.0.113.9');
    const spoofed = await request(app).get('/search').set('X-Forwarded-For', '10.0.0.1, 203.0.113.9');

    expect(spoofed.status).toBe(429);
  });
});
