const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

const HTML_TEMPLATE_PATH = path.join(__dirname, '../emails/vulnerability-report.hbs');
const TEXT_TEMPLATE_PATH = path.join(__dirname, '../emails/vulnerability-report.txt.hbs');
const SUBJECT_BASE = 'Weekly Vulnerability Report';

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

// Helper to convert country code to flag emoji
handlebars.registerHelper('countryFlag', function (countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return '';
  }
  // Convert country code to flag emoji using Regional Indicator Symbols
  // A=🇦(U+1F1E6), B=🇧(U+1F1E7), etc.
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
});

// Helper for equality comparison
handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

// Helper for greater than comparison
handlebars.registerHelper('gt', function (a, b) {
  return a > b;
});

/** Strip tags and decode entities, for titles stored as HTML (e.g. "Smith &#8211; Sons"). */
function toPlainText(value) {
  const withoutTags = String(value === null || value === undefined ? '' : value).replace(/<[^>]*>?/g, '');
  return withoutTags.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body) => {
    let decoded = entity;
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      decoded = codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    } else if (Object.hasOwn(NAMED_ENTITIES, body.toLowerCase())) {
      decoded = NAMED_ENTITIES[body.toLowerCase()];
    }
    return decoded;
  });
}

handlebars.registerHelper('plain', toPlainText);

/** Report wording, overridable from the environment. */
function reportBranding() {
  return {
    heading: process.env.REPORTING_HEADING || 'Website vulnerability report',
    openingParagraph: process.env.REPORTING_OPENING_PARAGRAPH || 'Here is your weekly vulnerability report for your WordPress plugins and themes:',
    closingParagraph:
      process.env.REPORTING_CLOSING_PARAGRAPH || 'This email does not contain any clickable links. To investigate your websites further, log in to your VULNZ account.',
    signOff: process.env.REPORTING_SIGN_OFF || 'The VULNZ Team',
    postScript: process.env.REPORTING_POST_SCRIPT || 'Stay safe online!',
  };
}

/**
 * Render the weekly report's subject line, HTML body and plain-text body from its template data.
 * @param {object} data  Template data from buildSummaryEmail().
 * @returns {{subject: string, html: string, text: string}}
 */
function renderVulnerabilityReport(data) {
  const context = { ...data, branding: reportBranding() };
  const html = handlebars.compile(fs.readFileSync(HTML_TEMPLATE_PATH, 'utf8'))(context);
  // noEscape: the text body is not HTML, so "&" must stay "&"
  const text = handlebars.compile(fs.readFileSync(TEXT_TEMPLATE_PATH, 'utf8'), { noEscape: true })(context);

  const criticalWebsites = (data.executiveSummary && data.executiveSummary.criticalWebsites) || 0;
  let subjectStatus = data.vulnerableWebsitesCount > 0 ? 'Attention Required!' : 'All Clear';
  if (criticalWebsites > 0) {
    subjectStatus = `${criticalWebsites} site(s) with critical vulnerabilities`;
  }

  return {
    subject: `${SUBJECT_BASE}: ${subjectStatus}`,
    html,
    text: text.replace(/\n{3,}/g, '\n\n').trim() + '\n',
  };
}

module.exports = {
  renderVulnerabilityReport,
  toPlainText,
};
