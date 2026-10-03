const appSetting = require('../models/appSetting');

// Used only when neither app_settings nor the legacy env var supplies a value.
const DEFAULT_WORDPRESS_CURRENT_VERSION = '6.7.1';
const DEFAULT_PHP_MINIMUM_VERSION = '8.0';
const DEFAULT_UNMAINTAINED_THRESHOLD_MONTHS = '6';
const DEFAULT_NEWLY_PUBLISHED_THRESHOLD_MONTHS = '3';

/**
 * Load the version and plugin-age thresholds the weekly email and the site report both judge against.
 * @returns {Promise<{wordpressCurrentVersion: string, phpMinimumVersion: string, unmaintainedThresholdMonths: number, newlyPublishedThresholdMonths: number}>}
 */
async function loadReportThresholds() {
  const wordpressCurrentVersion = await appSetting.getWithFallback('wordpress.current_version', 'WORDPRESS_STABLE_VERSION', DEFAULT_WORDPRESS_CURRENT_VERSION);
  const phpMinimumVersion = await appSetting.getWithFallback('php.minimum_version', 'PHP_MINIMUM_VERSION', DEFAULT_PHP_MINIMUM_VERSION);
  const unmaintainedThresholdMonths = await appSetting.getWithFallback(
    'plugin.unmaintained_threshold_months',
    'PLUGIN_UNMAINTAINED_THRESHOLD_MONTHS',
    DEFAULT_UNMAINTAINED_THRESHOLD_MONTHS
  );
  const newlyPublishedThresholdMonths = await appSetting.getWithFallback(
    'plugin.newly_published_threshold_months',
    'PLUGIN_NEWLY_PUBLISHED_THRESHOLD_MONTHS',
    DEFAULT_NEWLY_PUBLISHED_THRESHOLD_MONTHS
  );

  return {
    wordpressCurrentVersion: String(wordpressCurrentVersion),
    phpMinimumVersion: String(phpMinimumVersion),
    unmaintainedThresholdMonths: parseInt(unmaintainedThresholdMonths, 10),
    newlyPublishedThresholdMonths: parseInt(newlyPublishedThresholdMonths, 10),
  };
}

module.exports = { loadReportThresholds };
