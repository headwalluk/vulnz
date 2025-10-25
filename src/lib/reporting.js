const user = require('../models/user');
const website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const emailer = require('../lib/email');
const emailLog = require('../models/emailLog');
const { validateEmailAddress } = require('../lib/emailValidation');

async function sendSummaryEmail(userToSend) {
  const totalWebsites = await website.countAll(userToSend.id);
  const vulnerableWebsites = await website.findAll(userToSend.id, 1000, 0, null, true);

  for (const site of vulnerableWebsites) {
    const wordpressPlugins = await websiteComponent.getPlugins(site.id);
    const wordpressThemes = await websiteComponent.getThemes(site.id);
    site.vulnerableComponents = [...wordpressPlugins, ...wordpressThemes].filter((c) => c.has_vulnerabilities).map((c) => c.slug);
  }

  const emailData = {
    username: userToSend.username,
    totalWebsites,
    vulnerableWebsitesCount: vulnerableWebsites.length,
    vulnerableWebsites: vulnerableWebsites.map((site) => ({
      title: site.title,
      domain: site.domain,
      vulnerableComponents: site.vulnerableComponents,
    })),
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
  console.log( 'sendWeeklyReports: AAA');

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

  console.log( 'sendWeeklyReports: BBB');

  const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayOfWeek = weekdays[now.getDay()];

  const batchSize = parseInt(process.env.REPORTING_BATCH_SIZE, 10) || 10;
  const users = await user.findUsersForWeeklyReport(dayOfWeek, batchSize);

  console.log( `sendWeeklyReports: CCC': ${users.length} users to process` );
  console.log( users );

  for (const userToSend of users) {
    // Diagnostics
    console.log( `Sending emails to ${userToSend.username}`);

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
