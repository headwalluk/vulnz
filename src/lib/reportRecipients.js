const { validateEmailAddress } = require('./emailValidation');

const MAX_REPORTING_CC_ADDRESSES = 10;
const REPORTING_CC_MAX_LENGTH = 1000;
const REPORTING_CC_SEPARATOR = ',';
const STORED_CC_JOINER = ', ';
const TO_SOURCE_REPORTING_EMAIL = 'reporting_email';
const TO_SOURCE_USERNAME = 'username';

/**
 * Split a comma-separated CC list into valid and invalid addresses, trimmed, de-duplicated case-insensitively.
 * @param {string|null|undefined} rawCc
 * @returns {{addresses: string[], invalid: string[]}}
 */
function parseReportingCc(rawCc) {
  const addresses = [];
  const invalid = [];
  const seen = new Set();
  const entries = typeof rawCc === 'string' ? rawCc.split(REPORTING_CC_SEPARATOR) : [];
  for (const entry of entries) {
    const address = entry.trim();
    if (address === '' || seen.has(address.toLowerCase())) {
      continue;
    }
    seen.add(address.toLowerCase());
    if (validateEmailAddress(address).isValid) {
      addresses.push(address);
    } else {
      invalid.push(address);
    }
  }
  return { addresses, invalid };
}

/**
 * Validate a CC list for storage and return its normalised form ('' clears it).
 * @returns {{value: string}|{error: {error: string, message: string}}}
 */
function normaliseReportingCcForStorage(rawCc) {
  let result;
  if (rawCc === null || rawCc === '') {
    result = { value: '' };
  } else if (typeof rawCc !== 'string' || rawCc.length > REPORTING_CC_MAX_LENGTH) {
    result = {
      error: { error: 'Invalid reporting_cc', message: `reporting_cc must be a comma-separated list of email addresses, at most ${REPORTING_CC_MAX_LENGTH} characters.` },
    };
  } else {
    const { addresses, invalid } = parseReportingCc(rawCc);
    if (invalid.length > 0) {
      result = { error: { error: 'Invalid reporting_cc', message: `Not valid email addresses: ${invalid.join(', ')}. Nothing was changed.` } };
    } else if (addresses.length > MAX_REPORTING_CC_ADDRESSES) {
      result = { error: { error: 'Invalid reporting_cc', message: `reporting_cc can hold at most ${MAX_REPORTING_CC_ADDRESSES} addresses.` } };
    } else {
      result = { value: addresses.join(STORED_CC_JOINER) };
    }
  }
  return result;
}

/**
 * Who the weekly report for this account goes to, by the rules the sender applies.
 * The sender and every read-out call this, so they cannot disagree.
 *
 * @param {object} account  Row from the users table.
 * @returns {{to: string, to_source: string, reporting_email_rejected: boolean, cc: string[], cc_rejected: string[], weekday: string|null, paused: boolean, blocked: boolean, last_summary_sent_at: Date|string|null}}
 */
function resolveReportDelivery(account) {
  const reportingEmail = typeof account.reporting_email === 'string' ? account.reporting_email.trim() : '';
  const reportingEmailUsable = reportingEmail !== '' && validateEmailAddress(reportingEmail).isValid;
  const to = reportingEmailUsable ? reportingEmail : account.username;
  const { addresses, invalid } = parseReportingCc(account.reporting_cc);

  return {
    to,
    to_source: reportingEmailUsable ? TO_SOURCE_REPORTING_EMAIL : TO_SOURCE_USERNAME,
    reporting_email_rejected: reportingEmail !== '' && !reportingEmailUsable,
    // The main recipient is never copied in as well
    cc: addresses.filter((address) => address.toLowerCase() !== String(to).toLowerCase()),
    cc_rejected: invalid,
    weekday: account.reporting_weekday || null,
    paused: Boolean(account.paused),
    blocked: Boolean(account.blocked),
    last_summary_sent_at: account.last_summary_sent_at || null,
  };
}

module.exports = {
  parseReportingCc,
  normaliseReportingCcForStorage,
  resolveReportDelivery,
  MAX_REPORTING_CC_ADDRESSES,
  REPORTING_CC_MAX_LENGTH,
  STORED_CC_JOINER,
};
