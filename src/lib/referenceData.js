const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const AppSetting = require('../models/appSetting');

/**
 * Reference Data Updater
 * 
 * Fetches and applies reference configuration data (version thresholds, etc.)
 * from a trusted source (URL or local file).
 */

const TIMEOUT_MS = 5000;
const SEMVER_PATTERN = /^\d+\.\d+(\.\d+)?$/;

/**
 * Validate a version string using semver pattern
 * 
 * @param {string} version - Version string to validate
 * @returns {boolean} True if valid semver format
 */
const isValidVersion = (version) => {
  return typeof version === 'string' && SEMVER_PATTERN.test(version);
};

/**
 * Fetch reference data from a URL
 * 
 * @param {string} url - URL to fetch from
 * @returns {Promise<object>} Parsed JSON data
 */
const fetchFromUrl = (url) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    
    const request = client.get(url, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      });
    });
    
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Request timeout after ${TIMEOUT_MS}ms`));
    });
    
    request.on('error', (err) => {
      reject(err);
    });
  });
};

/**
 * Fetch reference data from a local file
 * 
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<object>} Parsed JSON data
 */
const fetchFromFile = async (filePath) => {
  try {
    // Resolve relative paths from project root
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(__dirname, '../../', filePath);
    
    const data = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`);
  }
};

/**
 * Validate and apply reference settings to database
 * 
 * @param {object} referenceData - Reference data object with app_settings
 * @returns {Promise<object>} Summary of updates
 */
const applyReferenceSettings = async (referenceData) => {
  if (!referenceData || !referenceData.app_settings) {
    throw new Error('Invalid reference data format: missing app_settings');
  }
  
  const settings = referenceData.app_settings;
  const summary = {
    updated: 0,
    skipped: 0,
    invalid: 0,
    unknown: 0,
    errors: []
  };
  
  for (const [key, value] of Object.entries(settings)) {
    try {
      // Check if setting exists in database
      const exists = await AppSetting.exists(key);
      
      if (!exists) {
        console.log(`⚠️  Unknown setting in reference data: ${key} (not in database)`);
        summary.unknown++;
        continue;
      }
      
      // Validate version strings (for settings with 'version' in the key)
      if (key.includes('version') && !isValidVersion(value)) {
        console.log(`⚠️  Invalid version format for ${key}: ${value}`);
        summary.invalid++;
        summary.errors.push(`${key}: invalid version format`);
        continue;
      }
      
      // Get current value to check if update is needed
      const currentValue = await AppSetting.get(key);
      
      if (currentValue === value) {
        summary.skipped++;
        continue;
      }
      
      // Determine the type based on the current setting
      // We trust the existing database schema for type information
      const allSettings = await AppSetting.getAll();
      const existingSetting = allSettings.find(s => s.key === key);
      
      if (!existingSetting) {
        summary.unknown++;
        continue;
      }
      
      // Update the setting (this will validate type compatibility)
      await AppSetting.set(
        key,
        value,
        existingSetting.type,
        existingSetting.description,
        existingSetting.category,
        existingSetting.isSystem
      );
      
      console.log(`✅ Updated ${key}: ${currentValue} → ${value}`);
      summary.updated++;
      
    } catch (err) {
      console.error(`❌ Error updating ${key}:`, err.message);
      summary.errors.push(`${key}: ${err.message}`);
    }
  }
  
  return summary;
};

/**
 * Update app settings from reference data source
 * 
 * @returns {Promise<object>} Summary of updates
 */
const updateFromReference = async () => {
  const method = process.env.REFERENCE_UPDATE_METHOD || 'disabled';
  const location = process.env.REFERENCE_UPDATE_LOCATION;
  
  if (method === 'disabled') {
    console.log('Reference data updates are disabled (REFERENCE_UPDATE_METHOD=disabled)');
    return { updated: 0, skipped: 0, method: 'disabled' };
  }
  
  if (!location) {
    console.error('❌ REFERENCE_UPDATE_LOCATION not configured');
    return { error: 'REFERENCE_UPDATE_LOCATION not configured' };
  }
  
  console.log(`Fetching reference data from ${method}: ${location}`);
  
  try {
    let referenceData;
    
    if (method === 'url') {
      referenceData = await fetchFromUrl(location);
    } else if (method === 'file') {
      referenceData = await fetchFromFile(location);
    } else {
      throw new Error(`Invalid REFERENCE_UPDATE_METHOD: ${method} (must be: url, file, or disabled)`);
    }
    
    const summary = await applyReferenceSettings(referenceData);
    
    console.log(`📊 Reference data update complete: ${summary.updated} updated, ${summary.skipped} unchanged, ${summary.unknown} unknown, ${summary.invalid} invalid`);
    
    if (summary.errors.length > 0) {
      console.error(`⚠️  Errors during update:`, summary.errors);
    }
    
    return { ...summary, method };
    
  } catch (err) {
    console.error(`❌ Failed to update from reference data:`, err.message);
    return { error: err.message, method };
  }
};

module.exports = {
  updateFromReference,
  isValidVersion,
  fetchFromUrl,
  fetchFromFile,
  applyReferenceSettings
};
