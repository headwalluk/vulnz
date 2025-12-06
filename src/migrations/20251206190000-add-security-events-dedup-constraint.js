const db = require('../db');

const up = async () => {
  const query = `
    ALTER TABLE security_events 
    ADD UNIQUE KEY dedup_constraint (website_id, event_type_id, source_ip, event_datetime)
  `;
  
  try {
    await db.query(query);
  } catch (err) {
    // Ignore if constraint already exists
    if (!err.message.includes('Duplicate key')) {
      throw err;
    }
  }
};

module.exports = {
  up,
};
