const db = require('../db');

const up = async () => {
  // 1. Create notification_sites table — registered WP/Woo sites that send notifications
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_sites (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      site_url VARCHAR(255) NOT NULL UNIQUE,
      data_secret VARCHAR(255) NOT NULL,
      ip_allowlist TEXT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // 2. Create notification_queue table — inbound notifications awaiting processing
  await db.query(`
    CREATE TABLE IF NOT EXISTS notification_queue (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      site_id BIGINT UNSIGNED NOT NULL,
      wp_user_id INT UNSIGNED NOT NULL,
      event VARCHAR(50) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
      next_retry_at TIMESTAMP NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP NULL,
      FOREIGN KEY (site_id) REFERENCES notification_sites(id) ON DELETE CASCADE,
      INDEX idx_nq_status (status),
      INDEX idx_nq_next_retry (status, next_retry_at)
    )
  `);

  // 3. Create user_subscriptions table — per-site subscription state for each user
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      site_id BIGINT UNSIGNED NOT NULL,
      wp_user_id INT UNSIGNED NOT NULL,
      subscription_id INT UNSIGNED NULL,
      account_email VARCHAR(255) NOT NULL,
      effective_state VARCHAR(30) NOT NULL DEFAULT 'provisioning',
      max_sites INT UNSIGNED NOT NULL DEFAULT 0,
      perpetual BOOLEAN DEFAULT FALSE,
      renewal_amount DECIMAL(10, 2) NULL,
      next_renewal_date DATE NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (site_id) REFERENCES notification_sites(id) ON DELETE CASCADE,
      UNIQUE KEY uk_user_site (user_id, site_id),
      INDEX idx_us_account_email (account_email),
      INDEX idx_us_effective_state (effective_state)
    )
  `);

  // 4. Seed default app setting for notification processing mode
  await db.query(`
    INSERT INTO app_settings (setting_key, setting_value, value_type, description, category, is_system)
    VALUES ('notifications.processing_mode', 'queue', 'string', 'How to process inbound notifications: immediate or queue', 'notifications', 0)
    ON DUPLICATE KEY UPDATE setting_key = setting_key
  `);
};

module.exports = { up };
