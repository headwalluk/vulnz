const Website = require('../models/website');
const websiteComponent = require('../models/websiteComponent');
const securityEvent = require('../models/securityEvent');
const fileSecurityIssue = require('../models/fileSecurityIssue');
const componentChange = require('../models/componentChange');
const component = require('../models/component');
const { loadReportThresholds } = require('./reportThresholds');
const { compareVersions } = require('./versionCompare');
const Advisory = require('../models/advisory');
const { severityForWebsites } = require('./siteSeverity');
const { resolveReportDelivery } = require('./reportRecipients');
const emailLog = require('../models/emailLog');

const DEFAULT_REPORT_DAYS = 7;
const MAX_REPORT_DAYS = 90;
const TOP_COUNTRY_LIMIT = 5;
const TOP_FILE_LIMIT = 10;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const WPORG_STATUS_CLOSED = 'closed';

/**
 * Judge an installed version against a reference.
 * @returns {boolean|null} true when older, false when not, null when either is unknown or undecidable
 */
const isOlderThan = (installed, reference) => {
  let older = null;
  if (installed && reference) {
    const comparison = compareVersions(String(installed), String(reference));
    older = comparison === null ? null : comparison < 0;
  }
  return older;
};

/** Whole days since a timestamp, or null when there is none. */
const daysSince = (timestamp, now) => (timestamp ? Math.floor((now - new Date(timestamp)) / MILLISECONDS_PER_DAY) : null);

/** The account's report delivery, with its latest logged weekly report. */
const reportDeliveryFor = async (owner) => {
  const [lastLoggedReport] = await emailLog.findForUser(parseInt(owner.id, 10), { emailType: emailLog.EMAIL_TYPE_VULNERABILITY_REPORT, limit: 1 });
  return { ...resolveReportDelivery(owner), last_logged_report: lastLoggedReport || null };
};

/** Shape one installed component for the report's component lists. */
const reportComponent = (installed) => ({
  slug: installed.slug,
  title: installed.title,
  component_type_slug: installed.component_type_slug,
  version: installed.version,
  latest_version: installed.latest_version,
  vulnerabilities: installed.vulnerabilities,
  max_cvss_score: installed.max_cvss_score,
  max_cvss_rating: installed.max_cvss_rating,
  unrated_vulnerabilities: installed.unrated_vulnerabilities,
  advisories: installed.advisories,
  is_malware: installed.is_malware,
  malware_summary: installed.malware_summary,
  wporg_status: installed.wporg_status,
  wporg_closure_reason: installed.wporg_closure_reason,
  wporg_closure_is_security_concern: installed.wporg_closure_is_security_concern,
});

/**
 * Assemble the report data for one website: the same facts the weekly email draws on, scoped to a single site.
 *
 * @param {object} website  Row from the websites table.
 * @param {object} options
 * @param {object|null} options.owner  The owner's users row, or null if it no longer exists.
 * @param {number} options.days  Length of the reporting period for events and changes.
 * @param {Date} [options.now]
 */
async function buildSiteReport(website, { owner, days, now = new Date() }) {
  const websiteId = parseInt(website.id, 10);
  const periodStart = new Date(now.getTime() - days * MILLISECONDS_PER_DAY);
  const thresholds = await loadReportThresholds();

  const inventory = await websiteComponent.getInventoryForReport(websiteId);
  const severityByRelease = await Advisory.severityForReleases(inventory.filter((installed) => installed.has_vulnerabilities).map((installed) => installed.release_id));
  for (const installed of inventory) {
    Object.assign(installed, severityByRelease.get(installed.release_id) || Advisory.emptySeverity());
  }
  const siteSeverity = (await severityForWebsites([websiteId])).get(websiteId);
  // Worst first, so the components that need a call lead; unrated after every rated one
  const vulnerable = inventory
    .filter((installed) => installed.has_vulnerabilities)
    .sort((left, right) => (Advisory.RATING_RANK[right.max_cvss_rating] ?? -1) - (Advisory.RATING_RANK[left.max_cvss_rating] ?? -1));
  const malware = inventory.filter((installed) => installed.is_malware);
  const withdrawn = inventory.filter((installed) => installed.wporg_status === WPORG_STATUS_CLOSED);
  const behindLatest = inventory.filter((installed) => isOlderThan(installed.version, installed.latest_version) === true);

  const fileCounts = await fileSecurityIssue.getFileCountsForWebsite(websiteId);
  const severityTotals = { error: 0, warning: 0, info: 0 };
  for (const file of fileCounts) {
    severityTotals.error += Number(file.error_count);
    severityTotals.warning += Number(file.warning_count);
    severityTotals.info += Number(file.info_count);
  }
  const fileIssueTotal = severityTotals.error + severityTotals.warning + severityTotals.info;

  const eventsByType = await securityEvent.getSummaryByDateRange(periodStart, now, [websiteId]);
  const topCountries = await securityEvent.getTopCountries(periodStart, now, TOP_COUNTRY_LIMIT, [websiteId]);
  const securityEventTotal = eventsByType.reduce((sum, eventType) => sum + Number(eventType.event_count), 0);

  const changes = await componentChange.getChangesByDateRange([websiteId], periodStart, now);
  const unmaintained = await component.findUnmaintainedPlugins(thresholds.unmaintainedThresholdMonths, null, websiteId);
  const newlyPublished = await component.findNewlyPublishedPlugins(thresholds.newlyPublishedThresholdMonths, null, websiteId);

  const wordpressOutdated = isOlderThan(website.wordpress_version, thresholds.wordpressCurrentVersion);
  const phpOutdated = isOlderThan(website.php_version, thresholds.phpMinimumVersion);

  return {
    website: {
      domain: website.domain,
      title: website.title,
      url: `${website.is_ssl ? 'https' : 'http'}://${website.domain}`,
      user_id: parseInt(website.user_id, 10),
      username: owner ? owner.username : null,
      // Reports go to the owning account, not the site: this is who receives the weekly email covering it
      report_delivery: owner ? await reportDeliveryFor(owner) : null,
      is_dev: Boolean(website.is_dev),
      server: Website.serverFromMeta(website.meta),
      wordpress_version: website.wordpress_version || null,
      php_version: website.php_version || null,
      db_server_type: website.db_server_type || 'unknown',
      db_server_version: website.db_server_version || null,
      versions_last_checked_at: website.versions_last_checked_at || null,
      days_since_versions_checked: daysSince(website.versions_last_checked_at, now),
    },
    generated_at: now.toISOString(),
    period: { days, from: periodStart.toISOString(), to: now.toISOString() },
    summary: {
      max_cvss_rating: siteSeverity.max_cvss_rating,
      severity_counts: siteSeverity.severity_counts,
      unrated_vulnerabilities: siteSeverity.unrated_vulnerabilities,
      component_count: inventory.length,
      vulnerable_components: vulnerable.length,
      malware_components: malware.length,
      withdrawn_components: withdrawn.length,
      components_behind_latest: behindLatest.length,
      wordpress_outdated: wordpressOutdated,
      php_outdated: phpOutdated,
      file_security_issues: fileIssueTotal,
      security_events: securityEventTotal,
      component_changes: changes.length,
      unmaintained_plugins: unmaintained.length,
      newly_published_plugins: newlyPublished.length,
    },
    software: {
      wordpress: { installed: website.wordpress_version || null, current: thresholds.wordpressCurrentVersion, is_outdated: wordpressOutdated },
      php: { installed: website.php_version || null, minimum: thresholds.phpMinimumVersion, is_outdated: phpOutdated },
    },
    components: {
      vulnerable: vulnerable.map(reportComponent),
      malware: malware.map(reportComponent),
      withdrawn: withdrawn.map(reportComponent),
      behind_latest: behindLatest.map(reportComponent),
    },
    file_security_issues: {
      total: fileIssueTotal,
      by_severity: severityTotals,
      top_files: fileCounts.slice(0, TOP_FILE_LIMIT).map((file) => ({
        file_path: file.file_path,
        issue_count: Number(file.issue_count),
        error_count: Number(file.error_count),
        warning_count: Number(file.warning_count),
        info_count: Number(file.info_count),
      })),
    },
    security_events: {
      total: securityEventTotal,
      by_type: eventsByType.map((eventType) => ({
        event_type: eventType.event_type,
        event_count: Number(eventType.event_count),
        unique_ips: Number(eventType.unique_ips),
      })),
      top_countries: topCountries.map((country) => ({ country_code: country.country_code, event_count: Number(country.event_count) })),
    },
    component_changes: changes.map((change) => ({
      changed_at: change.changed_at,
      change_type: change.change_type,
      component_slug: change.component_slug,
      component_title: change.component_title,
      component_type_slug: change.component_type_slug,
      old_version: change.old_version || null,
      new_version: change.new_version || null,
    })),
    plugins_to_monitor: {
      unmaintained_threshold_months: thresholds.unmaintainedThresholdMonths,
      newly_published_threshold_months: thresholds.newlyPublishedThresholdMonths,
      unmaintained: unmaintained.map((plugin) => ({
        slug: plugin.slug,
        title: plugin.title,
        last_updated: plugin.last_updated,
        months_since_update: Number(plugin.months_since_update),
      })),
      newly_published: newlyPublished.map((plugin) => ({
        slug: plugin.slug,
        title: plugin.title,
        added: plugin.added,
        months_since_published: Number(plugin.months_since_published),
      })),
    },
  };
}

module.exports = { buildSiteReport, DEFAULT_REPORT_DAYS, MAX_REPORT_DAYS };
