const mariadb = require('mariadb');
const dbConfig = require('./config/db');
const logger = require('./lib/logger');

const pool = mariadb.createPool({
  ...dbConfig,
  connectionLimit: 10,
  idleTimeout: 60000, // 60 seconds
});

// Log pool events for debugging
pool.on('acquire', (connection) => {
  logger.debug(`Connection ${connection.threadId} acquired`);
});

pool.on('release', (connection) => {
  logger.debug(`Connection ${connection.threadId} released`);
});

pool.on('error', (err) => {
  console.error('MariaDB pool error:', err);
});

async function query(sql, params) {
  let conn;
  try {
    conn = await pool.getConnection();
    return await conn.query(sql, params);
  } finally {
    if (conn) conn.release();
  }
}

async function end() {
  await pool.end();
}

module.exports = {
  query,
  end,
};
