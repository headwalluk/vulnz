const rateLimit = require('express-rate-limit');

const unauthenticatedSearchLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: parseInt(process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND, 10) || 10,
  handler: (req, res) => {
    if (req.isAuthenticated()) {
      return;
    }
    res.status(429).send('Too many requests, please try again later.');
  },
  keyGenerator: (req) => {
    if (req.isAuthenticated()) {
      return req.user.id; // Use user ID for authenticated users
    }
    // Use IP address for unauthenticated users
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },
  skip: () => parseInt(process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND, 10) === 0,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  },
});

module.exports = {
  unauthenticatedSearchLimiter,
  authLimiter,
};
