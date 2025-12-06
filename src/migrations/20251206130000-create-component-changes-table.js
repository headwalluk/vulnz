const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS component_changes (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      website_id BIGINT UNSIGNED NOT NULL,
      component_id BIGINT UNSIGNED NOT NULL,
      change_type ENUM('added', 'removed', 'updated') NOT NULL,
      old_release_id BIGINT UNSIGNED NULL,
      new_release_id BIGINT UNSIGNED NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      changed_by_user_id BIGINT UNSIGNED NULL,
      changed_via ENUM('api', 'ui', 'sync', 'plugin') DEFAULT 'api',
      
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      FOREIGN KEY (component_id) REFERENCES components(id) ON DELETE CASCADE,
      FOREIGN KEY (old_release_id) REFERENCES releases(id) ON DELETE SET NULL,
      FOREIGN KEY (new_release_id) REFERENCES releases(id) ON DELETE SET NULL,
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      
      INDEX idx_website_date (website_id, changed_at),
      INDEX idx_component (component_id),
      INDEX idx_change_type (change_type)
    )
  `;
  await db.query(query);
};

module.exports = {
  up,
};
