const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS file_security_issues (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      website_id BIGINT UNSIGNED NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      line_number INT UNSIGNED,
      issue_type VARCHAR(100) NOT NULL,
      severity ENUM('info', 'warning', 'error') DEFAULT 'warning',
      message TEXT,
      last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      
      INDEX idx_website_file (website_id, file_path(255)),
      INDEX idx_severity (severity),
      INDEX idx_last_seen (last_seen_at)
    )
  `;
  await db.query(query);
};

module.exports = {
  up,
};
