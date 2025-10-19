const apiCallLog = require('../models/apiCallLog');

async function logApiCall(req, res, next) {
  const username = req.user ? req.user.username : 'guest';
  if (process.env.LOG_LEVEL === 'debug') {
    console.log(`Logging API call for user: ${username}, route: ${req.originalUrl}, method: ${req.method}, IP: ${req.ip}`);
  }
  try {
    await apiCallLog.logCall(username, req.originalUrl, req.method, req.ip);
  } catch (err) {
    console.error('Failed to log API call:', err);
  }
  next();
}

module.exports = {
  logApiCall
};
