const db = require('../db');

const up = async () => {
  const query = `
    CREATE TABLE security_events (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      website_id INT UNSIGNED NOT NULL,
      event_type_id INT UNSIGNED NOT NULL,
      source_ip VARCHAR(45) NOT NULL,
      event_datetime TIMESTAMP NOT NULL,
      continent_code CHAR(2),
      country_code CHAR(2),
      details JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
      FOREIGN KEY (event_type_id) REFERENCES security_event_types(id) ON DELETE RESTRICT,
      
      INDEX idx_website_datetime (website_id, event_datetime),
      INDEX idx_event_type (event_type_id),
      INDEX idx_source_ip (source_ip),
      INDEX idx_country (country_code),
      INDEX idx_event_datetime (event_datetime)
    )
  `;
  await db.query(query);
};

module.exports = {
  up,
};
