const db = require('../db');

async function createTable() {
  // Table is created via migration
  // This function is kept for consistency with other models
}

async function create(websiteId, eventTypeId, sourceIp, eventDatetime, continentCode, countryCode, details = null) {
  const sql = `
    INSERT INTO security_events 
    (website_id, event_type_id, source_ip, event_datetime, continent_code, country_code, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  
  const detailsJson = details ? JSON.stringify(details) : null;
  const result = await db.query(sql, [
    websiteId,
    eventTypeId,
    sourceIp,
    eventDatetime,
    continentCode,
    countryCode,
    detailsJson
  ]);
  
  return result.insertId;
}

async function bulkCreate(events) {
  if (!events || events.length === 0) {
    return [];
  }

  const sql = `
    INSERT INTO security_events 
    (website_id, event_type_id, source_ip, event_datetime, continent_code, country_code, details)
    VALUES ?
  `;

  const values = events.map(event => [
    event.websiteId,
    event.eventTypeId,
    event.sourceIp,
    event.eventDatetime,
    event.continentCode || null,
    event.countryCode || null,
    event.details ? JSON.stringify(event.details) : null
  ]);

  const result = await db.query(sql, [values]);
  return result.insertId;
}

async function findByWebsite(websiteId, options = {}) {
  const { limit = 100, offset = 0, eventTypeId = null, fromDate = null, toDate = null } = options;
  
  let sql = `
    SELECT 
      se.*,
      set.slug as event_type_slug,
      set.title as event_type_title,
      set.severity
    FROM security_events se
    JOIN security_event_types set ON se.event_type_id = set.id
    WHERE se.website_id = ?
  `;
  
  const params = [websiteId];

  if (eventTypeId) {
    sql += ' AND se.event_type_id = ?';
    params.push(eventTypeId);
  }

  if (fromDate) {
    sql += ' AND se.event_datetime >= ?';
    params.push(fromDate);
  }

  if (toDate) {
    sql += ' AND se.event_datetime < ?';
    params.push(toDate);
  }

  sql += ' ORDER BY se.event_datetime DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const results = await db.query(sql, params);
  
  // Parse JSON details field
  return results.map(row => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null
  }));
}

async function getSummaryByDateRange(websiteIds, startDate, endDate) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      se.website_id,
      set.id as event_type_id,
      set.slug as event_type_slug,
      set.title as event_type_title,
      set.severity,
      se.country_code,
      se.continent_code,
      COUNT(*) as event_count
    FROM security_events se
    JOIN security_event_types set ON se.event_type_id = set.id
    WHERE se.website_id IN (?)
      AND se.event_datetime >= ?
      AND se.event_datetime < ?
    GROUP BY se.website_id, set.id, se.country_code, se.continent_code
    ORDER BY event_count DESC
  `;

  return await db.query(sql, [websiteIds, startDate, endDate]);
}

async function getTopCountries(websiteIds, startDate, endDate, limit = 10) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      country_code,
      COUNT(*) as event_count
    FROM security_events
    WHERE website_id IN (?)
      AND event_datetime >= ?
      AND event_datetime < ?
      AND country_code IS NOT NULL
    GROUP BY country_code
    ORDER BY event_count DESC
    LIMIT ?
  `;

  return await db.query(sql, [websiteIds, startDate, endDate, limit]);
}

async function getEventsByType(websiteIds, startDate, endDate) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      set.slug as event_type_slug,
      set.title as event_type_title,
      set.severity,
      COUNT(*) as event_count
    FROM security_events se
    JOIN security_event_types set ON se.event_type_id = set.id
    WHERE se.website_id IN (?)
      AND se.event_datetime >= ?
      AND se.event_datetime < ?
    GROUP BY set.id
    ORDER BY set.severity DESC, event_count DESC
  `;

  return await db.query(sql, [websiteIds, startDate, endDate]);
}

async function removeOldEvents(retentionDays = 30) {
  const sql = `
    DELETE FROM security_events 
    WHERE event_datetime < DATE_SUB(NOW(), INTERVAL ? DAY)
  `;
  
  const result = await db.query(sql, [retentionDays]);
  return result.affectedRows;
}

async function getTotalCount(websiteIds = null, startDate = null, endDate = null) {
  let sql = 'SELECT COUNT(*) as count FROM security_events WHERE 1=1';
  const params = [];

  if (websiteIds && websiteIds.length > 0) {
    sql += ' AND website_id IN (?)';
    params.push(websiteIds);
  }

  if (startDate) {
    sql += ' AND event_datetime >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND event_datetime < ?';
    params.push(endDate);
  }

  const result = await db.query(sql, params);
  return result[0].count;
}

module.exports = {
  createTable,
  create,
  bulkCreate,
  findByWebsite,
  getSummaryByDateRange,
  getTopCountries,
  getEventsByType,
  removeOldEvents,
  getTotalCount,
};
