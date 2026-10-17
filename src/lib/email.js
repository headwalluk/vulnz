const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { smtpEnabled } = require('./env');

// Always plain SMTP upgraded with STARTTLS when offered: implicit TLS (port 465) is not supported
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

/** Hand a message to the SMTP transport, or throw when SMTP_ENABLED is off. Callers check smtpEnabled() first; this is the backstop. */
async function deliver(mailOptions) {
  if (!smtpEnabled()) {
    throw new Error(`SMTP_ENABLED is off: refusing to send "${mailOptions.subject}"`);
  }
  await transporter.sendMail(mailOptions);
}

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

  await deliver(mailOptions);
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

  await deliver(mailOptions);
}

/**
 * The SMTP settings the transport was built from, without the password.
 * @returns {{host: string|null, port: string|null, secure: boolean, user: string|null, passwordSet: boolean, from: string|null, ignoreTls: boolean, smtpEnabled: boolean}}
 */
function describeTransport() {
  return {
    host: transportOptions.host || null,
    port: transportOptions.port || null,
    secure: transportOptions.secure,
    user: transportOptions.auth.user || null,
    passwordSet: Boolean(transportOptions.auth.pass),
    from: process.env.SMTP_FROM || null,
    ignoreTls: Boolean(transportOptions.tls),
    smtpEnabled: smtpEnabled(),
  };
}

/**
 * Check the SMTP connection and login, then send a short test message. Ignores SMTP_ENABLED: for the admin CLI only.
 * @param {string} to
 * @param {{version: string}} details shown in the message body
 * @returns {Promise<{messageId: string, accepted: string[], rejected: string[], response: string}>}
 */
async function sendTestEmail(to, { version }) {
  await transporter.verify();
  const sentAt = new Date().toISOString();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: to,
    subject: 'VULNZ test email',
    text: `This is a test email from VULNZ ${version}, sent at ${sentAt} by the vulnz email:test command.\n\nIf you can read this, the SMTP settings work.\n`,
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    response: info.response || '',
  };
}

module.exports = {
  sendVulnerabilityReport,
  sendMalwareAlert,
  describeTransport,
  sendTestEmail,
};
