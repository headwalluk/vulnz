const user = require('../models/user');
const { getRoles } = require('../models/user');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const securityEvent = require('../models/securityEvent');
const fileSecurityIssue = require('../models/fileSecurityIssue');
const componentChange = require('../models/componentChange');
const emailer = require('../lib/email');
const emailLog = require('../models/emailLog');
const { validateEmailAddress } = require('../lib/emailValidation');

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

  // Gather security events summary (past 7 days)
  const securityEventsSummary = await securityEvent.getSummaryByDateRange(startDate, endDate);
  const topAttackCountries = await securityEvent.getTopCountries(startDate, endDate, 5);

  // Get outdated software websites
  const outdatedWordPress = await website.findOutdatedWordPress(
    process.env.WORDPRESS_STABLE_VERSION || '6.7.1',
    isAdministrator ? null : userToSend.id
  );
  const outdatedPhp = await website.findOutdatedPhp(
    process.env.PHP_MINIMUM_VERSION || '8.0',
    isAdministrator ? null : userToSend.id
  );

  // Get static analysis issues summary
  const fileIssuesSummary = await fileSecurityIssue.getSummaryByWebsite(isAdministrator ? null : userToSend.id);
  const topIssueFiles = await fileSecurityIssue.getTopFilesByIssueCount(isAdministrator ? null : userToSend.id, 10);

  // Get component changes summary (past 7 days)
  const componentChangesSummary = await componentChange.getChangeSummary(startDate, endDate, isAdministrator ? null : userToSend.id);

  const emailData = {
    username: userToSend.username,
    totalWebsites,
    vulnerableWebsitesCount: vulnerableWebsites.length,
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
    componentChanges: componentChangesSummary,
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
