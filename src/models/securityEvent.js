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
    return { inserted: 0, duplicates: 0 };
  }


  // For single event, use simple insert with duplicate handling
  if (events.length === 1) {
    const event = events[0];
    try {
      await create(
        event.websiteId,
        event.eventTypeId,
        event.sourceIp,
        event.eventDatetime,
        event.continentCode,
        event.countryCode,
        event.details
      );
      return { inserted: 1, duplicates: 0 };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062 || err.message.includes('Duplicate entry')) {
        return { inserted: 0, duplicates: 1 };
      }
      throw err;
    }
  }

  // For multiple events, use INSERT IGNORE to skip duplicates
  const placeholders = events.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
  const sql = 'INSERT IGNORE INTO security_events (website_id, event_type_id, source_ip, event_datetime, continent_code, country_code, details) VALUES ' + placeholders;

  const values = events.flatMap(event => [
    event.websiteId,
    event.eventTypeId,
    event.sourceIp,
    event.eventDatetime,
    event.continentCode || null,
    event.countryCode || null,
    event.details ? JSON.stringify(event.details) : null
  ]);

  const result = await db.query(sql, values);
  const inserted = result.affectedRows;
  const duplicates = events.length - inserted;
  
  return { inserted, duplicates };
}

async function findByWebsite(websiteId, options = {}) {
  const { limit = 100, offset = 0, eventTypeId = null, fromDate = null, toDate = null } = options;
  
  let sql = `
    SELECT 
      se.*,
      evt.slug as event_type_slug,
      evt.title as event_type_title,
      evt.severity
    FROM security_events se
    JOIN security_event_types evt ON se.event_type_id = evt.id
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

async function getSummaryByDateRange(startDate, endDate, websiteIds = null) {
  let sql = `
    SELECT 
      evt.slug as event_type,
      COUNT(*) as event_count,
      COUNT(DISTINCT se.source_ip) as unique_ips
    FROM security_events se
    JOIN security_event_types evt ON se.event_type_id = evt.id
    WHERE se.event_datetime >= ?
      AND se.event_datetime < ?
  `;
  
  const params = [startDate, endDate];
  
  if (websiteIds && websiteIds.length > 0) {
    sql += ' AND se.website_id IN (?)';
    params.push(websiteIds);
  }
  
  sql += ' GROUP BY evt.id ORDER BY event_count DESC';

  return await db.query(sql, params);
}

async function getTopCountries(startDate, endDate, limit = 10, websiteIds = null) {
  let sql = `
    SELECT 
      country_code,
      COUNT(*) as event_count
    FROM security_events
    WHERE event_datetime >= ?
      AND event_datetime < ?
      AND country_code IS NOT NULL
  `;
  
  const params = [startDate, endDate];
  
  if (websiteIds && websiteIds.length > 0) {
    sql += ' AND website_id IN (?)';
    params.push(websiteIds);
  }
  
  sql += ' GROUP BY country_code ORDER BY event_count DESC LIMIT ?';
  params.push(limit);

  return await db.query(sql, params);
}

async function getEventsByType(startDate, endDate, websiteIds = null) {
  let sql = `
    SELECT 
      evt.slug as event_type_slug,
      evt.title as event_type_title,
      evt.severity,
      COUNT(*) as event_count
    FROM security_events se
    JOIN security_event_types evt ON se.event_type_id = evt.id
    WHERE se.event_datetime >= ?
      AND se.event_datetime < ?
  `;
  
  const params = [startDate, endDate];
  
  if (websiteIds && websiteIds.length > 0) {
    sql += ' AND se.website_id IN (?)';
    params.push(websiteIds);
  }
  
  sql += ' GROUP BY evt.id ORDER BY evt.severity DESC, event_count DESC';

  return await db.query(sql, params);
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
