const apiCallLog = require('../models/apiCallLog');

async function logApiCall(req, res, next) {
  if (req.originalUrl.startsWith('/api/logs')) {
    return next();
  }
  const originalSend = res.send;
  res.send = function() {
    const username = req.user ? req.user.username : 'guest';
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`Logging API call for user: ${username}, route: ${req.originalUrl}, method: ${req.method}, IP: ${req.ip}, status: ${res.statusCode}`);
    }
    try {
      apiCallLog.logCall(username, req.originalUrl, req.method, req.ip, res.statusCode);
    } catch (err) {
      console.error('Failed to log API call:', err);
    }
    originalSend.apply(res, arguments);
  };
  next();
}

module.exports = {
  logApiCall
};
