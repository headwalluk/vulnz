const { stripAll } = require('../../sanitizer');

const TASK_SLUG = 'release-urgency';
const MAX_TOKENS = 300;
const MAX_CHANGELOG_CHARS = 8000;
const MAX_SUMMARY_CHARS = 240;

/**
 * Convert a wordpress.org changelog section (HTML) to plain text.
 *
 * stripAll() removes tags but does not insert whitespace in their place, so
 * list items would otherwise run together. Closing block tags become newlines
 * first, which keeps one change per line and makes the changelog far easier
 * for a model to read.
 */
function changelogToText(html) {
  if (typeof html !== 'string') {
    return '';
  }

  const spaced = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(li|p|h[1-6]|ul|ol|div|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');

  return stripAll(spaced)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
    .substring(0, MAX_CHANGELOG_CHARS);
}

const SYSTEM_PROMPT = [
  'You classify WordPress plugin releases for a web hosting company.',
  '',
  'Every site the company hosts is already updated automatically overnight, on a routine schedule.',
  'Your classification decides one thing only: does this release justify interrupting that schedule',
  'and forcing an immediate, unscheduled update across the entire fleet right now?',
  '',
  'Mark a release urgent ONLY when the changelog indicates it fixes a security vulnerability that is',
  'realistically exploitable against a default installation — for example an unauthenticated or',
  'low-privileged attacker achieving cross-site scripting, SQL injection, remote code execution,',
  'arbitrary file upload or file read, authentication bypass, privilege escalation, PHP object',
  'injection, or a cross-site request forgery with real impact.',
  '',
  'Do NOT mark a release urgent for:',
  '- New features, enhancements, performance work, or compatibility updates.',
  '- Ordinary bug fixes with no security consequence.',
  '- Security fixes that require administrator privileges to exploit.',
  '- Updated third-party or transitive dependencies carrying security advisories, unless the',
  '  changelog states the plugin itself was actually exploitable through them.',
  '- General "hardening", refactoring, or defensive changes with no vulnerability described.',
  '- Deprecation notices, translation updates, or coding-standards work.',
  '',
  'If the changelog is vague, missing, or says only something like "minor bug fixes", it is NOT',
  'urgent: you have no evidence of a vulnerability. Judge only on the evidence in the changelog,',
  'and do not speculate in either direction.',
  '',
  'Respond with a single JSON object and nothing else, in exactly this form:',
  '{"is_urgent": true, "summary": "one short sentence"}',
  '',
  'The summary must be plain English, under 200 characters, and describe what the release actually',
  'contains. For an urgent release, state the vulnerability that was fixed. For a routine release,',
  'briefly describe the changes.',
].join('\n');

/**
 * Classify a wordpress.org plugin release as an emergency update or a routine
 * one, from its changelog.
 *
 * The wordpress.org API exposes no security flag for plugins — there is no
 * equivalent of the core stable-check insecure/outdated/latest status — so the
 * changelog is the only signal available at release time.
 */
module.exports = {
  slug: TASK_SLUG,
  description: 'Classify a WordPress plugin release as an urgent security update or a routine one',
  modelEnvVar: 'OPENROUTER_MODEL_RELEASE_URGENCY',
  maxTokens: MAX_TOKENS,
  systemPrompt: SYSTEM_PROMPT,

  /**
   * @param {{slug:string, version:string, changelog:string}} input
   * @returns {string}
   */
  buildUserPrompt({ slug, version, changelog }) {
    const text = changelogToText(changelog);
    if (text === '') {
      throw new Error('Changelog is empty after conversion to plain text.');
    }

    return [`Plugin: ${slug}`, `Version: ${version}`, '', 'Changelog:', text].join('\n');
  },

  /**
   * Validate and normalise the model's JSON response.
   * @param {object} parsed
   * @returns {{is_urgent:boolean, summary:string}}
   */
  parseResult(parsed) {
    if (typeof parsed.is_urgent !== 'boolean') {
      throw new Error('Field "is_urgent" is missing or not a boolean.');
    }
    if (typeof parsed.summary !== 'string' || parsed.summary.trim() === '') {
      throw new Error('Field "summary" is missing or empty.');
    }

    return {
      is_urgent: parsed.is_urgent,
      summary: stripAll(parsed.summary).trim().substring(0, MAX_SUMMARY_CHARS),
    };
  },

  // Exported for tests.
  changelogToText,
};
