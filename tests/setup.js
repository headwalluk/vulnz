/**
 * Test setup utilities
 *
 * Provides database initialization and helper functions for test suites
 */

const sqlite3 = require('sqlite3');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');

/**
 * Create an in-memory SQLite database for testing
 * @returns {Promise<Object>} Database connection with promisified methods
 */
async function createTestDatabase() {
  const db = new sqlite3.Database(':memory:');

  // Prom isify database methods
  const get = promisify(db.get.bind(db));
  const all = promisify(db.all.bind(db));
  const exec = promisify(db.exec.bind(db));

  // Special handling for run to capture lastID and changes
  const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  };

  // MySQL-compatible query method for our existing code
  const query = async (sql, params = []) => {
    // Convert MySQL syntax to SQLite
    let convertedSql = sql;

    // Handle ON DUPLICATE KEY UPDATE -> INSERT OR REPLACE or UPSERT
    if (convertedSql.includes('ON DUPLICATE KEY UPDATE')) {
      // For app_settings table with PRIMARY KEY on setting_key
      if (convertedSql.includes('app_settings')) {
        // Extract the columns from INSERT
        const insertMatch = convertedSql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
        if (insertMatch) {
          const tableName = insertMatch[1];
          const columns = insertMatch[2].split(',').map((c) => c.trim());

          // Convert to SQLite UPSERT syntax
          convertedSql = `
            INSERT INTO ${tableName} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
            ON CONFLICT(setting_key) DO UPDATE SET
              setting_value = excluded.setting_value,
              value_type = excluded.value_type,
              description = excluded.description,
              category = excluded.category,
              updated_at = CURRENT_TIMESTAMP
          `;
        }
      }
    }

    if (convertedSql.trim().toUpperCase().startsWith('SELECT') || convertedSql.trim().toUpperCase().startsWith('SHOW')) {
      return all(convertedSql, params);
    } else {
      const result = await run(convertedSql, params);
      return {
        affectedRows: result.changes || 0,
        insertId: result.lastID || 0,
      };
    }
  };

  return {
    db,
    query,
    run,
    get,
    all,
    exec,
    close: promisify(db.close.bind(db)),
  };
}

/**
 * Initialize test database schema
 * Manually creates tables with SQLite-compatible syntax
 * @param {Object} db - Database connection
 */
async function initializeSchema(db) {
  // Create users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create api_keys table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name VARCHAR(255) NOT NULL,
      key_hash VARCHAR(64) NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create websites table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS websites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      domain VARCHAR(255) NOT NULL,
      title VARCHAR(255) NOT NULL,
      is_ssl INTEGER DEFAULT 1,
      is_dev INTEGER NOT NULL DEFAULT 0,
      meta TEXT,
      wordpress_version VARCHAR(20),
      php_version VARCHAR(20),
      db_server_type TEXT DEFAULT 'unknown',
      db_server_version VARCHAR(20),
      versions_last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, domain)
    )
  `);

  // Create roles table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(50) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create user_roles junction table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    )
  `);

  // Seed roles
  await db.run(`INSERT OR IGNORE INTO roles (name) VALUES ('administrator')`);
  await db.run(`INSERT OR IGNORE INTO roles (name) VALUES ('user')`);

  // Create app_settings table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(255) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'string',
      description TEXT,
      category VARCHAR(100),
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default app settings
  const settings = [
    ['wordpress.current_version', '6.7.1', 'string', 'Current stable WordPress version', 'wordpress', 1],
    ['wordpress.minimum_supported_version', '6.4', 'string', 'Minimum supported WordPress version', 'wordpress', 1],
    ['php.current_version', '8.3', 'string', 'Current stable PHP version', 'php', 1],
    ['php.minimum_supported_version', '7.4', 'string', 'Minimum supported PHP version', 'php', 1],
    ['php.recommended_version', '8.2', 'string', 'Recommended PHP version', 'php', 1],
    ['database.mysql_current_version', '8.4', 'string', 'Current stable MySQL version', 'database', 1],
    ['database.mariadb_current_version', '11.4', 'string', 'Current stable MariaDB version', 'database', 1],
  ];

  for (const [key, value, type, desc, category, isSystem] of settings) {
    await db.run(
      `INSERT OR IGNORE INTO app_settings (setting_key, setting_value, value_type, description, category, is_system) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, value, type, desc, category, isSystem]
    );
  }
}

/**
 * Create a test user
 * @param {Object} db - Database connection
 * @param {Object} userData - User data
 * @returns {Promise<Object>} Created user with ID
 */
async function createTestUser(db, userData = {}) {
  const defaultData = {
    username: 'testuser',
    password: 'password123',
    email: 'test@example.com',
    role: 'user',
    is_active: 1,
  };

  const user = { ...defaultData, ...userData };
  const hashedPassword = await bcrypt.hash(user.password, 10);

  const result = await db.query(
    `INSERT INTO users (username, password_hash, email, role, is_active) 
     VALUES (?, ?, ?, ?, ?)`,
    [user.username, hashedPassword, user.email, user.role, user.is_active]
  );

  const userId = result.insertId;

  // Assign role to user
  const roleName = user.role === 'admin' ? 'administrator' : 'user';
  const roleRows = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
  if (roleRows && roleRows.length > 0) {
    await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleRows[0].id]);
  }

  return {
    id: userId,
    username: user.username,
    email: user.email,
    role: user.role,
    password: user.password, // Return plaintext password for testing
  };
}

/**
 * Create an API key for a user
 * @param {Object} db - Database connection
 * @param {number} userId - User ID
 * @param {string} name - API key name
 * @returns {Promise<Object>} Created API key with token
 */
async function createTestApiKey(db, userId, name = 'Test Key') {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const result = await db.query(
    `INSERT INTO api_keys (user_id, name, key_hash, is_active) 
     VALUES (?, ?, ?, 1)`,
    [userId, name, hashedToken]
  );

  return {
    id: result.insertId,
    token, // Return unhashed token for testing
    userId,
    name,
  };
}

/**
 * Create a test website
 * @param {Object} db - Database connection
 * @param {number} userId - Owner user ID
 * @param {Object} websiteData - Website data
 * @returns {Promise<Object>} Created website with ID
 */
async function createTestWebsite(db, options = {}) {
  const defaultData = {
    domain: 'test.example.com',
    title: 'Test Website',
    is_ssl: 1,
    is_dev: 0,
    wordpress_version: '6.4.2',
    php_version: '8.2.0',
    db_server_type: 'mariadb',
    db_server_version: '10.11.6',
  };

  const website = { ...defaultData, ...options };

  const result = await db.query(
    `INSERT INTO websites (user_id, domain, title, is_ssl, is_dev, wordpress_version, php_version, db_server_type, db_server_version) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      website.user_id,
      website.domain,
      website.title,
      website.is_ssl,
      website.is_dev,
      website.wordpress_version,
      website.php_version,
      website.db_server_type,
      website.db_server_version,
    ]
  );

  return {
    id: result.insertId,
    ...website,
  };
}

/**
 * Clean up test database
 * @param {Object} db - Database connection
 */
async function cleanupTestDatabase(db) {
  if (db && db.close) {
    await db.close();
  }
}

module.exports = {
  createTestDatabase,
  initializeSchema,
  createTestUser,
  createTestApiKey,
  createTestWebsite,
  cleanupTestDatabase,
};
