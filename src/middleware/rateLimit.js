const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// These env vars are normalized at startup by src/lib/env.js.
// Fallback defaults are provided for test environments where normalizeEnv() may not have run.
function intOrDefault(envVar, fallback) {
  const n = parseInt(process.env[envVar], 10);
  return Number.isNaN(n) ? fallback : n;
}

const unauthSearchLimit = intOrDefault('UNAUTH_SEARCH_LIMIT_PER_SECOND', 1);
const unauthSearchWindowSeconds = intOrDefault('UNAUTH_SEARCH_WINDOW_SECONDS', 10);

/**
 * The sustained rate stays UNAUTH_SEARCH_LIMIT_PER_SECOND on average; the
 * window is what decides how much of it can be spent at once.
 *
 * Search-as-you-type is bursty by nature — a few requests in quick
 * succession while someone types a slug, then nothing for ten seconds. A
 * one-second window rejected that pattern even when the average rate was
 * well within budget, so the public search box on vulnz.net returned 429s
 * during ordinary use. Counting over a longer window absorbs the burst
 * without raising the sustained rate a scraper could achieve.
 */
const unauthSearchMax = Math.max(1, unauthSearchLimit * unauthSearchWindowSeconds);

const unauthenticatedSearchLimiter = rateLimit({
  windowMs: unauthSearchWindowSeconds * 1000,
  limit: unauthSearchMax,

  // Emit RateLimit-* and Retry-After so a client can back off deliberately
  // rather than guessing.
  standardHeaders: 'draft-7',
  legacyHeaders: false,

  /**
   * Authenticated callers are not rate-limited here — they are identified,
   * logged, and revocable, so the IP-based budget for anonymous browsing
   * does not apply to them.
   *
   * This requires `optionalApiAuth` to run BEFORE this middleware, so that
   * req.user is populated by the time skip() is consulted. It previously ran
   * after, which quietly made every authenticated search subject to the
   * anonymous limit.
   */
  skip: (req) => unauthSearchLimit === 0 || Boolean(req.user),

  /**
   * Key on req.ip, not on the raw X-Forwarded-For header.
   *
   * `app.set('trust proxy', 1)` means Express already derives the client
   * address from the last trusted hop. Reading the header directly took a
   * client-supplied value, so anyone could sidestep the limit entirely by
   * varying it, and a multi-proxy request produced a "client, proxy1" list
   * as the key rather than an address.
   *
   * ipKeyGenerator() normalises IPv6 to a /56, so a single client cannot
   * rotate through its own prefix for a fresh budget each time.
   */
  keyGenerator: (req) => ipKeyGenerator(req.ip),

  handler: (req, res) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfterSeconds = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : unauthSearchWindowSeconds;

    res.status(429).json({
      error: 'Too many requests',
      message: 'Search is rate limited for unauthenticated callers. Slow down, or use an API key.',
      retry_after_seconds: retryAfterSeconds,
    });
  },
});

module.exports = {
  unauthenticatedSearchLimiter,
};
