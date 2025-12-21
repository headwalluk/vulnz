function decodeHtmlEntities(str) {
  if (typeof str !== 'string') {
    return '';
  }
  // Decode common HTML entities
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
  };
  
  let decoded = str;
  // First decode named entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.split(entity).join(char);
  }
  // Then decode numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  return decoded;
}

function stripAll(str) {
  if (typeof str !== 'string') {
    return '';
  }
  let sanitized = str;
  sanitized = sanitized.replace(/<[^>]*>?/gm, ''); // Strip HTML tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''); // Strip script tags
  sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, ''); // Strip email addresses
  sanitized = decodeHtmlEntities(sanitized); // Decode HTML entities to plain text
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

  let sanitized = version.replace(/[^0-9.]+[a-z]+[0-9]+/g, '').replace(/[^0-9.]/g, '');

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

function stripNonAlphaNumeric(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .join(' ');
}

function sanitizeSearchQuery(str) {
  if (typeof str !== 'string') {
    return '';
  }
  return str
    .replace(/[^a-zA-Z0-9\-_ ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .join(' ');
}

function sanitizeComponentSlug(slug) {
  if (typeof slug !== 'string') {
    return '';
  }
  let sanitized = slug.toLowerCase();
  const lastDotIndex = sanitized.lastIndexOf('.');
  if (lastDotIndex > 0) {
    sanitized = sanitized.substring(0, lastDotIndex);
  }
  return sanitized;
}

module.exports = {
  stripAll,
  isUrl,
  sanitizeVersion,
  stripNonAlphaNumeric,
  sanitizeSearchQuery,
  sanitizeComponentSlug,
  decodeHtmlEntities,
};
