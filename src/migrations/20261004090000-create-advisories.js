const db = require('../db');

/**
 * M28 Batch C (C1): advisories, with their severity and the URLs they are known by.
 * The first slice of M22's advisory entity; see docs/version-matching.md for how
 * vulnerabilities reach releases. vulnerabilities rows link to advisories through
 * url_hash, so that table is unchanged. Each step checks current state, so re-runs
 * are no-ops.
 */

const ADVISORY_SOURCES = [
  ['wordfence', 'Wordfence Intelligence'],
  ['osv', 'OSV.dev'],
];

// slug, title, rank (higher is worse), lowest CVSS v3 score in the band
const CVSS_RATINGS = [
  ['critical', 'Critical', 4, 9.0],
  ['high', 'High', 3, 7.0],
  ['medium', 'Medium', 2, 4.0],
  ['low', 'Low', 1, 0.1],
  ['none', 'None', 0, 0.0],
];

const up = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS advisory_sources (
      slug VARCHAR(32) NOT NULL PRIMARY KEY,
      title VARCHAR(255) NOT NULL
    )
  `);
  for (const [slug, title] of ADVISORY_SOURCES) {
    await db.query('INSERT IGNORE INTO advisory_sources (slug, title) VALUES (?, ?)', [slug, title]);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS cvss_ratings (
      slug VARCHAR(16) NOT NULL PRIMARY KEY,
      title VARCHAR(64) NOT NULL,
      \`rank\` TINYINT UNSIGNED NOT NULL,
      min_score DECIMAL(3,1) NOT NULL
    )
  `);
  for (const [slug, title, rank, minScore] of CVSS_RATINGS) {
    await db.query('INSERT IGNORE INTO cvss_ratings (slug, title, `rank`, min_score) VALUES (?, ?, ?, ?)', [slug, title, rank, minScore]);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS advisories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_slug VARCHAR(32) NOT NULL,
      external_id VARCHAR(255) NOT NULL,
      title VARCHAR(512) NULL,
      cve VARCHAR(32) NULL,
      cwe_id INT UNSIGNED NULL,
      cwe_name VARCHAR(255) NULL,
      cvss_score DECIMAL(3,1) NULL,
      cvss_rating_slug VARCHAR(16) NULL,
      cvss_vector VARCHAR(255) NULL,
      is_informational TINYINT(1) NOT NULL DEFAULT 0,
      published_at DATETIME NULL,
      source_updated_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY advisories_source_external_unique (source_slug, external_id),
      KEY advisories_cve (cve),
      FOREIGN KEY (source_slug) REFERENCES advisory_sources(slug),
      FOREIGN KEY (cvss_rating_slug) REFERENCES cvss_ratings(slug)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS advisory_urls (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      advisory_id BIGINT UNSIGNED NOT NULL,
      url VARCHAR(2048) NOT NULL,
      url_hash BINARY(32) AS (UNHEX(SHA2(url, 256))) STORED,
      -- MariaDB allows a generated column in a unique key, but not in the primary key
      UNIQUE KEY advisory_urls_advisory_url (advisory_id, url_hash),
      KEY advisory_urls_url_hash (url_hash),
      KEY advisory_urls_url (url(255)),
      FOREIGN KEY (advisory_id) REFERENCES advisories(id) ON DELETE CASCADE
    )
  `);
};

module.exports = {
  up,
  ADVISORY_SOURCES,
  CVSS_RATINGS,
};
