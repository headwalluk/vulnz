/**
 * Public-facing files must not point into the private dev-notes/ area or name the private plugin.
 * dev-notes/ is gitignored; AGENTS.md and CLAUDE.md are internal and may reference it.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const PUBLIC_DIRECTORIES = ['docs', 'src', 'bin'];
const PUBLIC_ROOT_FILES = ['README.md', 'CHANGELOG.md', '.env.example'];
const DEV_NOTES_REFERENCE = 'dev-notes/';
const PRIVATE_PLUGIN_NAME = 'vulnz-woo';
const PLUGIN_NAME_RESTRICTED_FILES = ['README.md', 'CHANGELOG.md'];

/** Every file under a directory, as repo-relative paths. */
function listFiles(relativeDirectory) {
  const files = [];
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, relativeDirectory), { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

const publicFiles = [...PUBLIC_ROOT_FILES, ...PUBLIC_DIRECTORIES.flatMap(listFiles)];

describe('public-facing files', () => {
  test.each(publicFiles)('%s does not reference dev-notes/', (relativePath) => {
    const contents = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

    expect(contents.includes(DEV_NOTES_REFERENCE)).toBe(false);
  });

  test.each(PLUGIN_NAME_RESTRICTED_FILES)('%s does not name the private plugin', (relativePath) => {
    const contents = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

    expect(contents.includes(PRIVATE_PLUGIN_NAME)).toBe(false);
  });
});
