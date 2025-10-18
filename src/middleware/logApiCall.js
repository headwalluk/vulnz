const apiCallLog = require('../models/apiCallLog');
const db = require('../db');

async function logApiCall(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (req.user && apiKey) {
    try {
      const [key] = await db.query('SELECT id FROM api_keys WHERE api_key = ?', [apiKey]);
      if (key) {
        apiCallLog.logCall(req.user.id, key.id, req.originalUrl, req.method);
      }
    } catch (err) {
      console.error('Failed to log API call:', err);
    }
  }
  next();
}

module.exports = {
  logApiCall
};
