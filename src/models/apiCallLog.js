const db = require('../db');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS api_call_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      route VARCHAR(255) NOT NULL,
      method VARCHAR(10) NOT NULL,
      ip_address VARCHAR(45) NOT NULL,
      status_code INT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX(timestamp),
      INDEX(username)
    )
  `;
  await db.query(sql);
}

async function logCall(username, route, method, ipAddress, statusCode) {
  await db.query(
    'INSERT INTO api_call_logs (username, route, method, ip_address, status_code) VALUES (?, ?, ?, ?, ?)',
    [username, route, method, ipAddress, statusCode]
  );
}

async function purgeOldLogs() {
  const retentionDays = parseInt(process.env.API_LOG_RETENTION_DAYS, 10);
  if (isNaN(retentionDays) || retentionDays <= 0) {
    console.log('API_LOG_RETENTION_DAYS is not set or is invalid. Skipping log purge.');
    return;
  }

  const sql = `
    DELETE FROM api_call_logs
    WHERE timestamp < NOW() - INTERVAL ? DAY
  `;
  
  try {
    const [result] = await db.query(sql, [retentionDays]);
    console.log(`Purged ${result.affectedRows} old API call logs.`);
  } catch (err) {
    console.error('Failed to purge old API call logs:', err);
  }
}

module.exports = {
  createTable,
  logCall,
  purgeOldLogs,
};
