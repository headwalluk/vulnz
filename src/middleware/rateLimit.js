const rateLimit = require('express-rate-limit');

// These env vars are normalized at startup by src/lib/env.js.
// Fallback defaults are provided for test environments where normalizeEnv() may not have run.
function intOrDefault(envVar, fallback) {
  const n = parseInt(process.env[envVar], 10);
  return Number.isNaN(n) ? fallback : n;
}

const unauthSearchLimit = intOrDefault('UNAUTH_SEARCH_LIMIT_PER_SECOND', 1);
const authWindowMinutes = intOrDefault('AUTH_RATE_LIMIT_WINDOW_MINUTES', 15);
const authMax = intOrDefault('AUTH_RATE_LIMIT_MAX', 100);

const unauthenticatedSearchLimiter = rateLimit({
  windowMs: 1000,
  max: unauthSearchLimit,
  handler: (req, res) => {
    if (req.isAuthenticated()) {
      return;
    }
    res.status(429).send('Too many requests, please try again later.');
  },
  keyGenerator: (req) => {
    if (req.isAuthenticated()) {
      return req.user.id;
    }
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },
  skip: () => unauthSearchLimit === 0,
});

const authLimiter = rateLimit({
  windowMs: authWindowMinutes * 60 * 1000,
  max: authMax,
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },
});

module.exports = {
  unauthenticatedSearchLimiter,
  authLimiter,
};
