const db = require('../db');

/**
 * AppSetting Model
 * 
 * Key-value configuration store for runtime parameters.
 * Supports typed values (string, integer, float, boolean) with automatic casting.
 */

const createTable = async () => {
  // Table creation is handled by migration
  // This is here for consistency with other models
};

/**
 * Get a setting value by key with type casting
 * 
 * @param {string} key - The setting key (dot-namespaced)
 * @returns {Promise<string|number|boolean|null>} The typed value or null if not found
 */
const get = async (key) => {
  const query = 'SELECT setting_value, value_type FROM app_settings WHERE setting_key = ?';
  const rows = await db.query(query, [key]);
  
  if (rows.length === 0) {
    return null;
  }
  
  const { setting_value, value_type } = rows[0];
  
  // Cast the value based on its type
  switch (value_type) {
    case 'integer':
      return parseInt(setting_value, 10);
    case 'float':
      return parseFloat(setting_value);
    case 'boolean':
      return setting_value === 'true';
    case 'string':
    default:
      return setting_value;
  }
};

/**
 * Get a setting value with fallback to environment variable
 * Useful during migration period from .env to database
 * 
 * @param {string} key - The setting key
 * @param {string} envVar - Environment variable name to fall back to
 * @param {*} defaultValue - Default value if neither source has the value
 * @returns {Promise<*>} The value from database, env, or default
 */
const getWithFallback = async (key, envVar, defaultValue = null) => {
  const dbValue = await get(key);
  if (dbValue !== null) {
    return dbValue;
  }
  
  if (envVar && process.env[envVar]) {
    // Emit deprecation warning
    console.warn(`⚠️  Using deprecated environment variable ${envVar}. Please migrate to app_settings.`);
    
    // Try to parse the env value appropriately
    const envValue = process.env[envVar];
    if (envValue === 'true') return true;
    if (envValue === 'false') return false;
    if (!isNaN(envValue) && !isNaN(parseFloat(envValue))) {
      return envValue.includes('.') ? parseFloat(envValue) : parseInt(envValue, 10);
    }
    return envValue;
  }
  
  return defaultValue;
};

/**
 * Set a setting value
 * 
 * @param {string} key - The setting key (dot-namespaced)
 * @param {*} value - The value to store
 * @param {string} type - Value type: 'string', 'integer', 'float', 'boolean'
 * @param {string} description - Human-readable description (optional)
 * @param {string} category - Category for grouping (optional)
 * @param {boolean} isSystem - Whether this is a system setting (optional)
 * @returns {Promise<void>}
 */
const set = async (key, value, type = 'string', description = null, category = null, isSystem = false) => {
  // Validate value type
  const validTypes = ['string', 'integer', 'float', 'boolean'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid value_type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }
  
  // Convert value to string for storage
  let stringValue;
  if (type === 'boolean') {
    stringValue = value ? 'true' : 'false';
  } else {
    stringValue = String(value);
  }
  
  // Validate key format (should be dot-namespaced)
  if (!key.match(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/)) {
    throw new Error(`Invalid setting key format: ${key}. Use lowercase letters, numbers, underscores, and dots only.`);
  }
  
  const query = `
    INSERT INTO app_settings (setting_key, setting_value, value_type, description, category, is_system)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      setting_value = VALUES(setting_value),
      value_type = VALUES(value_type),
      description = VALUES(description),
      category = VALUES(category),
      updated_at = CURRENT_TIMESTAMP
  `;
  
  await db.query(query, [key, stringValue, type, description, category, isSystem ? 1 : 0]);
};

/**
 * Get all settings, optionally filtered by category
 * 
 * @param {string} category - Optional category to filter by
 * @returns {Promise<Array>} Array of setting objects with typed values
 */
const getAll = async (category = null) => {
  let query = `
    SELECT setting_key, setting_value, value_type, description, category, is_system, created_at, updated_at
    FROM app_settings
  `;
  const params = [];
  
  if (category) {
    query += ' WHERE category = ?';
    params.push(category);
  }
  
  query += ' ORDER BY category, setting_key';
  
  const rows = await db.query(query, params);
  
  // Cast values to their proper types
  return rows.map(row => ({
    key: row.setting_key,
    value: castValue(row.setting_value, row.value_type),
    rawValue: row.setting_value,
    type: row.value_type,
    description: row.description,
    category: row.category,
    isSystem: Boolean(row.is_system),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

/**
 * Get settings grouped by category
 * 
 * @returns {Promise<Object>} Object with categories as keys, arrays of settings as values
 */
const getAllGrouped = async () => {
  const settings = await getAll();
  
  return settings.reduce((acc, setting) => {
    const cat = setting.category || 'uncategorized';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(setting);
    return acc;
  }, {});
};

/**
 * Delete a setting by key
 * System settings cannot be deleted
 * 
 * @param {string} key - The setting key to delete
 * @returns {Promise<boolean>} True if deleted, false if not found or protected
 */
const remove = async (key) => {
  // Check if this is a system setting
  const query = 'SELECT is_system FROM app_settings WHERE setting_key = ?';
  const rows = await db.query(query, [key]);
  
  if (rows.length === 0) {
    return false; // Setting doesn't exist
  }
  
  if (rows[0].is_system) {
    throw new Error(`Cannot delete system setting: ${key}`);
  }
  
  const deleteQuery = 'DELETE FROM app_settings WHERE setting_key = ?';
  const result = await db.query(deleteQuery, [key]);
  
  return result.affectedRows > 0;
};

/**
 * Check if a setting exists
 * 
 * @param {string} key - The setting key to check
 * @returns {Promise<boolean>} True if exists, false otherwise
 */
const exists = async (key) => {
  const query = 'SELECT 1 FROM app_settings WHERE setting_key = ? LIMIT 1';
  const rows = await db.query(query, [key]);
  return rows.length > 0;
};

/**
 * Get multiple settings by keys in a single query
 * 
 * @param {Array<string>} keys - Array of setting keys to retrieve
 * @returns {Promise<Object>} Object with keys mapped to their typed values
 */
const getMany = async (keys) => {
  if (!Array.isArray(keys) || keys.length === 0) {
    return {};
  }
  
  const placeholders = keys.map(() => '?').join(',');
  const query = `SELECT setting_key, setting_value, value_type FROM app_settings WHERE setting_key IN (${placeholders})`;
  const rows = await db.query(query, keys);
  
  const result = {};
  rows.forEach(row => {
    result[row.setting_key] = castValue(row.setting_value, row.value_type);
  });
  
  return result;
};

/**
 * Helper function to cast a value based on its type
 * 
 * @param {string} value - The string value from database
 * @param {string} type - The value type
 * @returns {*} The casted value
 */
const castValue = (value, type) => {
  switch (type) {
    case 'integer':
      return parseInt(value, 10);
    case 'float':
      return parseFloat(value);
    case 'boolean':
      return value === 'true';
    case 'string':
    default:
      return value;
  }
};

module.exports = {
  createTable,
  get,
  getWithFallback,
  set,
  getAll,
  getAllGrouped,
  remove,
  exists,
  getMany
};
