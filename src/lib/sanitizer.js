function stripAll(str) {
  if (typeof str !== 'string') {
    return '';
  }
  let sanitized = str;
  sanitized = sanitized.replace(/<[^>]*>?/gm, ''); // Strip HTML tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''); // Strip script tags
  sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, ''); // Strip email addresses
  sanitized = sanitized.replace(/&#\d+;/g, ''); // Strip HTML entities
  return sanitized;
}

function isUrl(str) {
  if (typeof str !== 'string') {
    return false;
  }
  return /^(ftp|http|https):\/\/[^ "]+$/.test(str);
}

function sanitizeVersion(version) {
  if (typeof version !== 'string') {
    return '0';
  }

  let sanitized = version.replace(/[^0-9\.][a-z]+[0-9]+/g,'').replace(/[^0-9.]/g, '');

  if (sanitized.startsWith('.')) {
    sanitized = `0${sanitized}`;
  }

  if (sanitized.endsWith('.')) {
    sanitized = `${sanitized}0`;
  }

  if (sanitized === '' || sanitized === null) {
    return '0';
  }

  return sanitized;
}

module.exports = {
  stripAll,
  isUrl,
  sanitizeVersion,
};
