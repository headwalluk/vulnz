const user = require('../models/user');
const { getRoles } = require('../models/user');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const securityEvent = require('../models/securityEvent');
const fileSecurityIssue = require('../models/fileSecurityIssue');
const componentChange = require('../models/componentChange');
const component = require('../models/component');
const appSetting = require('../models/appSetting');
const emailer = require('../lib/email');
const emailLog = require('../models/emailLog');
const { validateEmailAddress } = require('../lib/emailValidation');

/**
 * Format a date/datetime into a human-readable string with relative time
 * @param {Date|string} dateValue - Date to format
 * @returns {string} Formatted date like "Feb 8, 2025 (10 months ago)"
 */
function formatHumanDate(dateValue) {
  if (!dateValue) return 'Unknown';

  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return 'Invalid date';

  const now = new Date();
  const diffMs = now - date;
  const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  let relative = '';
  if (diffMonths >= 1) {
    relative = `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  } else if (diffDays >= 1) {
    relative = `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    relative = 'today';
  }

  return `${formatted} (${relative})`;
}

/**
 * Deduplicate plugins by grouping them across multiple websites
 * @param {Array} plugins - Array of plugin objects with website info
 * @returns {Array} Deduplicated plugins with websites array
 */
function deduplicatePlugins(plugins) {
  const pluginMap = new Map();

  for (const plugin of plugins) {
    const key = plugin.slug;

    if (!pluginMap.has(key)) {
      pluginMap.set(key, {
        title: plugin.title,
        slug: plugin.slug,
        lastUpdated: plugin.lastUpdated,
        added: plugin.added,
        monthsSinceUpdate: plugin.monthsSinceUpdate,
        monthsSincePublished: plugin.monthsSincePublished,
        websites: [],
      });
    }

    pluginMap.get(key).websites.push({
      domain: plugin.domain,
      websiteTitle: plugin.websiteTitle,
    });
  }

  return Array.from(pluginMap.values());
}

async function sendSummaryEmail(userToSend) {
  const roles = await getRoles(userToSend.id);
  const isAdministrator = roles.includes('administrator');

  const totalWebsites = await website.countAll(isAdministrator ? null : userToSend.id);
  const vulnerableWebsites = await website.findAll(isAdministrator ? null : userToSend.id, 1000, 0, null, true);

  for (const site of vulnerableWebsites) {
    const wordpressPlugins = await websiteComponent.getPlugins(site.id);
    const wordpressThemes = await websiteComponent.getThemes(site.id);
    site.vulnerableComponents = [...wordpressPlugins, ...wordpressThemes].filter((c) => c.has_vulnerabilities).map((c) => `${c.title} ${c.version} (${c.slug})`);
  }

  // Get date range for the past 7 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

  // Get website IDs for filtering security events
  const userWebsites = await website.findAll(isAdministrator ? null : userToSend.id, 10000, 0);
  const websiteIds = userWebsites.map((site) => site.id);

  // Gather security events summary (past 7 days) - filtered by user's websites
  const securityEventsSummary = await securityEvent.getSummaryByDateRange(startDate, endDate, websiteIds);
  const topAttackCountries = await securityEvent.getTopCountries(startDate, endDate, 5, websiteIds);

  // Get outdated software websites
  const wordpressCurrentVersion = await appSetting.getWithFallback('wordpress.current_version', 'WORDPRESS_STABLE_VERSION', '6.7.1');
  const phpMinimumVersion = await appSetting.getWithFallback('php.minimum_version', 'PHP_MINIMUM_VERSION', '8.0');

  const outdatedWordPress = await website.findOutdatedWordPress(wordpressCurrentVersion, isAdministrator ? null : userToSend.id);
  const outdatedPhp = await website.findOutdatedPhp(phpMinimumVersion, isAdministrator ? null : userToSend.id);

  // Get static analysis issues summary
  const fileIssuesSummary = await fileSecurityIssue.getSummaryByWebsite(isAdministrator ? null : userToSend.id);
  const topIssueFiles = await fileSecurityIssue.getTopFilesByIssueCount(isAdministrator ? null : userToSend.id, 10);

  // Get component changes summary (past 7 days)
  const componentChangesSummary = await componentChange.getChangeSummary(startDate, endDate, isAdministrator ? null : userToSend.id);

  // Get plugins to monitor (unmaintained and newly published)
  const unmaintainedThresholdMonths = await appSetting.getWithFallback('plugin.unmaintained_threshold_months', 'PLUGIN_UNMAINTAINED_THRESHOLD_MONTHS', '6');
  const newlyPublishedThresholdMonths = await appSetting.getWithFallback('plugin.newly_published_threshold_months', 'PLUGIN_NEWLY_PUBLISHED_THRESHOLD_MONTHS', '3');

  const unmaintainedPlugins = await component.findUnmaintainedPlugins(parseInt(unmaintainedThresholdMonths, 10), isAdministrator ? null : userToSend.id);
  const newlyPublishedPlugins = await component.findNewlyPublishedPlugins(parseInt(newlyPublishedThresholdMonths, 10), isAdministrator ? null : userToSend.id);

  // Deduplicate plugins
  const deduplicatedUnmaintained = deduplicatePlugins(
    unmaintainedPlugins.map((p) => ({
      title: p.title,
      slug: p.slug,
      lastUpdated: p.last_updated,
      monthsSinceUpdate: p.months_since_update,
      domain: p.domain,
      websiteTitle: p.website_title,
    }))
  );

  const deduplicatedNewlyPublished = deduplicatePlugins(
    newlyPublishedPlugins.map((p) => ({
      title: p.title,
      slug: p.slug,
      added: p.added,
      monthsSincePublished: p.months_since_published,
      domain: p.domain,
      websiteTitle: p.website_title,
    }))
  );

  // Calculate total security events (convert BigInt to Number)
  const totalSecurityEvents = securityEventsSummary.reduce((sum, evt) => sum + Number(evt.event_count), 0);
  const totalStaticIssues = fileIssuesSummary.reduce((sum, site) => sum + Number(site.total_issues), 0);
  const totalComponentChanges = componentChangesSummary.length;

  // Build executive summary
  const executiveSummary = {
    vulnerableWebsites: vulnerableWebsites.length,
    totalWebsites,
    securityEvents: totalSecurityEvents,
    outdatedWordPress: outdatedWordPress.length,
    outdatedPhp: outdatedPhp.length,
    staticIssues: totalStaticIssues,
    componentChanges: totalComponentChanges,
    unmaintainedPlugins: deduplicatedUnmaintained.length,
    newlyPublishedPlugins: deduplicatedNewlyPublished.length,
  };

  // Build recommended actions
  const recommendedActions = [];
  if (vulnerableWebsites.length > 0) {
    recommendedActions.push({
      priority: 'critical',
      action: `Update ${vulnerableWebsites.length} website${vulnerableWebsites.length === 1 ? '' : 's'} with known vulnerabilities`,
    });
  }
  if (outdatedWordPress.length > 0) {
    recommendedActions.push({
      priority: 'high',
      action: `Update WordPress on ${outdatedWordPress.length} website${outdatedWordPress.length === 1 ? '' : 's'}`,
    });
  }
  if (outdatedPhp.length > 0) {
    recommendedActions.push({
      priority: 'high',
      action: `Upgrade PHP on ${outdatedPhp.length} website${outdatedPhp.length === 1 ? '' : 's'}`,
    });
  }
  if (deduplicatedUnmaintained.length > 0) {
    recommendedActions.push({
      priority: 'medium',
      action: `Review ${deduplicatedUnmaintained.length} unmaintained plugin${deduplicatedUnmaintained.length === 1 ? '' : 's'} - consider alternatives`,
    });
  }
  if (totalStaticIssues > 0) {
    recommendedActions.push({
      priority: 'medium',
      action: `Address ${totalStaticIssues} static analysis issue${totalStaticIssues === 1 ? '' : 's'} found in code`,
    });
  }
  if (deduplicatedNewlyPublished.length > 0) {
    recommendedActions.push({
      priority: 'low',
      action: `Monitor ${deduplicatedNewlyPublished.length} newly published plugin${deduplicatedNewlyPublished.length === 1 ? '' : 's'} for stability`,
    });
  }

  const emailData = {
    username: userToSend.username,
    totalWebsites,
    vulnerableWebsitesCount: vulnerableWebsites.length,
    executiveSummary,
    recommendedActions,
    vulnerableWebsites: vulnerableWebsites.map((site) => ({
      title: site.title,
      domain: site.domain,
      vulnerableComponents: site.vulnerableComponents,
    })),
    securityEvents: {
      summary: securityEventsSummary,
      topCountries: topAttackCountries,
    },
    outdatedSoftware: {
      wordpress: outdatedWordPress.map((site) => ({
        title: site.title,
        domain: site.domain,
        version: site.wordpress_version,
      })),
      php: outdatedPhp.map((site) => ({
        title: site.title,
        domain: site.domain,
        version: site.php_version,
      })),
    },
    staticAnalysis: {
      summary: fileIssuesSummary,
      topFiles: topIssueFiles.map((f) => ({
        domain: f.domain,
        filePath: f.file_path,
        issueCount: f.issue_count,
        criticalCount: f.critical_count,
        highCount: f.high_count,
      })),
    },
    componentChanges: componentChangesSummary.map((c) => ({
      ...c,
      changed_at: formatHumanDate(c.changed_at),
    })),
    pluginsToMonitor: {
      unmaintained: deduplicatedUnmaintained.map((p) => ({
        ...p,
        lastUpdated: formatHumanDate(p.lastUpdated),
      })),
      newlyPublished: deduplicatedNewlyPublished.map((p) => ({
        ...p,
        added: formatHumanDate(p.added),
      })),
      unmaintainedThresholdMonths: parseInt(unmaintainedThresholdMonths, 10),
      newlyPublishedThresholdMonths: parseInt(newlyPublishedThresholdMonths, 10),
    },
  };

  let targetEmail = userToSend.username;
  if (userToSend.reporting_email) {
    const validation = validateEmailAddress(userToSend.reporting_email);
    if (validation.isValid) {
      targetEmail = userToSend.reporting_email;
    }
  }

  try {
    await emailer.sendVulnerabilityReport(targetEmail, emailData);
    await emailLog.logEmail(targetEmail, 'vulnerability_report', 'sent');
  } catch (emailError) {
    await emailLog.logEmail(targetEmail, 'vulnerability_report', 'error');
    throw emailError;
  }
}

async function sendWeeklyReports() {
  const reportingHour = parseInt(process.env.REPORTING_HOUR, 10);
  if (isNaN(reportingHour) || reportingHour < 0 || reportingHour > 23) {
    console.error('REPORTING_HOUR is not set or is invalid (must be 0-23). Skipping weekly report cron job.');
    return;
  }

  const now = new Date();
  const currentHour = now.getHours();

  if (currentHour < reportingHour) {
    return;
  }

  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayOfWeek = weekdays[now.getDay()];

  const batchSize = parseInt(process.env.REPORTING_BATCH_SIZE, 10) || 10;
  const users = await user.findUsersForWeeklyReport(dayOfWeek, batchSize);

  for (const userToSend of users) {
    // Diagnostics
    console.log(`Sending emails to ${userToSend.username}`);

    try {
      await sendSummaryEmail(userToSend);
      await user.updateLastSummarySentAt(userToSend.id);
    } catch (err) {
      console.error(`Failed to send summary email to user ${userToSend.id}:`, err);
    }
  }

  if (now.getHours() === 23 && now.getMinutes() >= 45) {
    const remainingUsers = await user.countUsersDueForWeeklyReport(dayOfWeek);
    if (remainingUsers > 0) {
      console.error(`CRITICAL: ${remainingUsers} users did not receive their weekly summary email today.`);
    }
  }
}

module.exports = {
  sendSummaryEmail,
  sendWeeklyReports,
};
