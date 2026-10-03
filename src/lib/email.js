const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');

// secure: process.env.SMTP_SECURE === 'true',
const transportOptions = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {},
};

if (process.env.SMTP_USER || process.env.SMTP_PASS) {
  transportOptions.auth = {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };
}

if (process.env.SMTP_IGNORE_TLS === 'true') {
  transportOptions.tls = {
    rejectUnauthorized: false,
  };
}

const transporter = nodemailer.createTransport(transportOptions);

/**
 * Send the weekly vulnerability report, rendered by renderVulnerabilityReport(), with HTML and plain-text parts.
 * @param {string} to
 * @param {{subject: string, html: string, text: string}} rendered
 * @param {string[]} [cc]  Copied in on the same message, so each recipient can see the others were told.
 */
async function sendVulnerabilityReport(to, rendered, cc = []) {
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };
  if (cc.length > 0) {
    mailOptions.cc = cc;
  }

  await transporter.sendMail(mailOptions);
}

/**
 * Immediate known-malware alert (M15).
 *
 * Deliberately separate from the weekly vulnerability report: this is not a
 * digest and is not branded as one. It fires the moment a flagged component
 * is seen on a site, and the subject line is written to be readable in a
 * notification preview without opening the mail.
 *
 * @param {string} to recipient address
 * @param {object} data domain, websiteTitle, owner, isDev, detectedAt, components[]
 */
async function sendMalwareAlert(to, data) {
  const templatePath = path.join(__dirname, '../emails/malware-alert.hbs');
  const template = fs.readFileSync(templatePath, 'utf8');
  const compiledTemplate = handlebars.compile(template);

  const componentCount = Array.isArray(data.components) ? data.components.length : 0;
  const html = compiledTemplate({
    ...data,
    componentCount,
    isSingle: componentCount === 1,
  });

  const slugSummary = (data.components || []).map((component) => component.slug).join(', ');

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: to,
    subject: `MALWARE DETECTED: ${data.domain} (${slugSummary})`,
    html: html,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendVulnerabilityReport,
  sendMalwareAlert,
};
