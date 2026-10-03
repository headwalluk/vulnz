const user = require('../models/user');
const { getRoles } = require('../models/user');
const { ROLE_ADMINISTRATOR } = require('../models/role');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const securityEvent = require('../models/securityEvent');
const fileSecurityIssue = require('../models/fileSecurityIssue');
const componentChange = require('../models/componentChange');
const component = require('../models/component');
const { loadReportThresholds } = require('./reportThresholds');
const { resolveReportDelivery } = require('./reportRecipients');
const { severityForWebsites } = require('./siteSeverity');
const emailer = require('../lib/email');
const emailLog = require('../models/emailLog');
const logger = require('./logger');

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

/**
 * Build and send the summary report for one user; returns false without sending when they have no websites.
 * @param {object} userToSend  The account the report is about.
 * @param {{previewRecipient?: object|null}} [options]  Send the report to this account alone instead, uncopied.
 * @returns {Promise<boolean>} Whether a report was sent.
 */
async function sendSummaryEmail(userToSend, { previewRecipient = null } = {}) {
  const roles = await getRoles(userToSend.id);
  const isAdministrator = roles.includes(ROLE_ADMINISTRATOR);

  const totalWebsites = await website.countAll(isAdministrator ? null : userToSend.id);
  if (totalWebsites === 0) {
    logger.info(`Report for user ${userToSend.id} not sent: no websites on the account`);
    return false;
  }

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

  const { wordpressCurrentVersion, phpMinimumVersion, unmaintainedThresholdMonths, newlyPublishedThresholdMonths } = await loadReportThresholds();

  // Get outdated software websites

  const outdatedWordPress = await website.findOutdatedWordPress(wordpressCurrentVersion, isAdministrator ? null : userToSend.id);
  const outdatedPhp = await website.findOutdatedPhp(phpMinimumVersion, isAdministrator ? null : userToSend.id);

  // Get static analysis issues summary
  const fileIssuesSummary = await fileSecurityIssue.getSummaryByWebsite(isAdministrator ? null : userToSend.id);
  const topIssueFiles = await fileSecurityIssue.getTopFilesByIssueCount(isAdministrator ? null : userToSend.id, 10);

  // Get component changes summary (past 7 days)
  const componentChangesSummary = await componentChange.getChangeSummary(startDate, endDate, isAdministrator ? null : userToSend.id);

  // Get plugins to monitor (unmaintained and newly published)
  const unmaintainedPlugins = await component.findUnmaintainedPlugins(unmaintainedThresholdMonths, isAdministrator ? null : userToSend.id);
  const newlyPublishedPlugins = await component.findNewlyPublishedPlugins(newlyPublishedThresholdMonths, isAdministrator ? null : userToSend.id);

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
  // Only advisories rated critical count; an unrated vulnerability is never presented as critical
  const severityBySite = await severityForWebsites(vulnerableWebsites.map((site) => parseInt(site.id, 10)));
  const criticalCounts = [...severityBySite.values()].map((severity) => severity.severity_counts.critical);

  const executiveSummary = {
    vulnerableWebsites: vulnerableWebsites.length,
    criticalWebsites: criticalCounts.filter((count) => count > 0).length,
    criticalComponents: criticalCounts.reduce((sum, count) => sum + count, 0),
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
    user: {
      username: userToSend.username,
      enable_white_label: userToSend.enable_white_label,
      white_label_html: userToSend.white_label_html,
    },
    totalWebsites,
    vulnerableWebsitesCount: vulnerableWebsites.length,
    executiveSummary,
    recommendedActions,
    vulnerableWebsites: vulnerableWebsites.map((site) => ({
      title: site.title,
      domain: site.domain,
      vulnerableComponents: site.vulnerableComponents,
    })),
    allWebsites: userWebsites.map((site) => ({
      title: site.title,
      domain: site.domain,
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
      unmaintainedThresholdMonths,
      newlyPublishedThresholdMonths,
    },
  };

  let to;
  let cc;
  let emailType;
  let logContext;
  let subjectPrefix = '';
  if (previewRecipient) {
    // Logged against the requester, so the previewed account's last-report history is untouched
    to = resolveReportDelivery(previewRecipient).to;
    cc = [];
    emailType = emailLog.EMAIL_TYPE_VULNERABILITY_REPORT_PREVIEW;
    logContext = { userId: parseInt(previewRecipient.id, 10) };
    subjectPrefix = `[Preview for ${userToSend.username}] `;
  } else {
    const delivery = resolveReportDelivery(userToSend);
    if (delivery.reporting_email_rejected || delivery.cc_rejected.length > 0) {
      logger.warn(
        `Report for user ${userToSend.id}: unusable reporting addresses skipped (reporting_email rejected: ${delivery.reporting_email_rejected}; cc rejected: ${delivery.cc_rejected.join(', ') || 'none'})`
      );
    }
    to = delivery.to;
    cc = delivery.cc;
    emailType = emailLog.EMAIL_TYPE_VULNERABILITY_REPORT;
    logContext = { userId: parseInt(userToSend.id, 10), ccEmails: cc };
  }

  try {
    await emailer.sendVulnerabilityReport(to, emailData, cc, { subjectPrefix });
    await emailLog.logEmail(to, emailType, 'sent', logContext);
  } catch (emailError) {
    await emailLog.logEmail(to, emailType, 'error', logContext);
    throw emailError;
  }

  return true;
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
    logger.info(`Sending emails to ${userToSend.username}`);

    try {
      // Stamped even when skipped for having no websites, so the user leaves today's queue
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
