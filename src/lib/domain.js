const WWW_PREFIX = 'www.';

/**
 * Reduce a caller-supplied site reference to a bare lower-case host.
 * Accepts `https://Example.com:8443/path?x=1`, `example.com.` and the like.
 * @param {string} rawDomain
 * @returns {string} the host, or '' when nothing usable remains
 */
const normaliseDomainInput = (rawDomain) => {
  if (typeof rawDomain !== 'string') {
    return '';
  }
  return rawDomain
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
};

/**
 * The exact domains a lenient lookup tries, in order: the normalised host,
 * then the same host with `www.` added or removed.
 * @param {string} rawDomain
 * @returns {string[]}
 */
const domainCandidates = (rawDomain) => {
  const host = normaliseDomainInput(rawDomain);
  let candidates = [];
  if (host) {
    const alternative = host.startsWith(WWW_PREFIX) ? host.slice(WWW_PREFIX.length) : `${WWW_PREFIX}${host}`;
    candidates = alternative ? [host, alternative] : [host];
  }
  return candidates;
};

module.exports = { normaliseDomainInput, domainCandidates };
