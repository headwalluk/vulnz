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

async function sendPasswordResetEmail(to, token) {
  const resetLink = `${process.env.BASE_URL}/reset-password?token=${token}`;
  const templatePath = path.join(__dirname, '../emails/password-reset.hbs');
  const template = fs.readFileSync(templatePath, 'utf8');
  const compiledTemplate = handlebars.compile(template);

  const expiryHours = Math.floor(parseInt(process.env.PASSWORD_RESET_TOKEN_DURATION, 10) / 3600);
  const expiryMessage = `This link will expire in ${expiryHours} hour${expiryHours === 1 ? '' : 's'}.`;

  const html = compiledTemplate({
    resetLink,
    expiryMessage,
  });

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: to,
    subject: 'Password Reset Request',
    html: html,
  };

  await transporter.sendMail(mailOptions);
}

async function sendVulnerabilityReport(to, data) {
  const templatePath = path.join(__dirname, '../emails/vulnerability-report.hbs');
  const template = fs.readFileSync(templatePath, 'utf8');
  const compiledTemplate = handlebars.compile(template);

  const branding = {
    heading: process.env.REPORTING_HEADING || 'Website vulnerability report',
    openingParagraph: process.env.REPORTING_OPENING_PARAGRAPH || 'Here is your weekly vulnerability report for your WordPress plugins and themes:',
    closingParagraph:
      process.env.REPORTING_CLOSING_PARAGRAPH || 'This email does not contain any clickable links. To investigate your websites further, log in to your VULNZ account.',
    signOff: process.env.REPORTING_SIGN_OFF || 'The VULNZ Team',
    postScript: process.env.REPORTING_POST_SCRIPT || 'Stay safe online!',
  };

  const html = compiledTemplate({ ...data, branding });

  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: to,
    subject: 'Weekly Vulnerability Report',
    html: html,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendPasswordResetEmail,
  sendVulnerabilityReport,
};
