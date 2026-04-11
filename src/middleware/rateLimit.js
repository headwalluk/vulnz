const rateLimit = require('express-rate-limit');

// This env var is normalized at startup by src/lib/env.js.
// Fallback default is provided for test environments where normalizeEnv() may not have run.
function intOrDefault(envVar, fallback) {
  const n = parseInt(process.env[envVar], 10);
  return Number.isNaN(n) ? fallback : n;
}

const unauthSearchLimit = intOrDefault('UNAUTH_SEARCH_LIMIT_PER_SECOND', 1);

const unauthenticatedSearchLimiter = rateLimit({
  windowMs: 1000,
  max: unauthSearchLimit,
  handler: (req, res) => {
    if (req.user) {
      return;
    }
    res.status(429).send('Too many requests, please try again later.');
  },
  keyGenerator: (req) => {
    if (req.user) {
      return req.user.id;
    }
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },
  skip: () => unauthSearchLimit === 0,
});

module.exports = {
  unauthenticatedSearchLimiter,
};
