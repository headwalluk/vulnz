const db = require('../db');

async function createTable() {
  // Table is created via migration
  // This function is kept for consistency with other models
}

async function create(websiteId, filePath, lineNumber, issueType, severity, message) {
  const sql = `
    INSERT INTO file_security_issues 
    (website_id, file_path, line_number, issue_type, severity, message, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `;
  
  const result = await db.query(sql, [
    websiteId,
    filePath,
    lineNumber || null,
    issueType,
    severity,
    message
  ]);
  
  return result.insertId;
}

async function upsertIssue(websiteId, filePath, lineNumber, issueType, severity, message) {
  // Check if issue already exists
  const checkSql = `
    SELECT id FROM file_security_issues
    WHERE website_id = ? AND file_path = ? AND issue_type = ? 
    AND (line_number = ? OR (line_number IS NULL AND ? IS NULL))
  `;
  
  const existing = await db.query(checkSql, [
    websiteId,
    filePath,
    issueType,
    lineNumber,
    lineNumber
  ]);

  if (existing && existing.length > 0) {
    // Update last_seen_at
    const updateSql = `
      UPDATE file_security_issues 
      SET last_seen_at = CURRENT_TIMESTAMP, severity = ?, message = ?
      WHERE id = ?
    `;
    await db.query(updateSql, [severity, message, existing[0].id]);
    return existing[0].id;
  } else {
    // Create new
    return await create(websiteId, filePath, lineNumber, issueType, severity, message);
  }
}

async function bulkUpsert(issues) {
  const results = {
    created: 0,
    updated: 0,
    errors: []
  };

  for (const issue of issues) {
    try {
      await upsertIssue(
        issue.websiteId,
        issue.filePath,
        issue.lineNumber,
        issue.issueType,
        issue.severity,
        issue.message
      );
      results.created++;
    } catch (err) {
      results.errors.push({ issue, error: err.message });
    }
  }

  return results;
}

async function deleteByFilePath(websiteId, filePath) {
  const sql = 'DELETE FROM file_security_issues WHERE website_id = ? AND file_path = ?';
  const result = await db.query(sql, [websiteId, filePath]);
  return result.affectedRows || 0;
}

async function findByWebsite(websiteId, options = {}) {
  const { limit = 100, offset = 0, severity = null, filePath = null } = options;
  
  let sql = `
    SELECT *
    FROM file_security_issues
    WHERE website_id = ?
  `;
  
  const params = [websiteId];

  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity);
  }

  if (filePath) {
    sql += ' AND file_path LIKE ?';
    params.push(`%${filePath}%`);
  }

  sql += ' ORDER BY severity DESC, file_path ASC, line_number ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return await db.query(sql, params);
}

async function getSummaryByWebsite(websiteId) {
  const sql = `
    SELECT 
      severity,
      COUNT(*) as count
    FROM file_security_issues
    WHERE website_id = ?
    GROUP BY severity
  `;
  
  return await db.query(sql, [websiteId]);
}

async function getSummaryByDateRange(websiteIds, startDate, endDate) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      website_id,
      severity,
      issue_type,
      COUNT(*) as count
    FROM file_security_issues
    WHERE website_id IN (?)
      AND created_at >= ?
      AND created_at < ?
    GROUP BY website_id, severity, issue_type
    ORDER BY count DESC
  `;

  return await db.query(sql, [websiteIds, startDate, endDate]);
}

async function getTopFilesByIssueCount(websiteIds, limit = 10) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      website_id,
      file_path,
      COUNT(*) as issue_count,
      SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END) as error_count,
      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning_count,
      SUM(CASE WHEN severity = 'info' THEN 1 ELSE 0 END) as info_count
    FROM file_security_issues
    WHERE website_id IN (?)
    GROUP BY website_id, file_path
    ORDER BY error_count DESC, warning_count DESC, issue_count DESC
    LIMIT ?
  `;

  return await db.query(sql, [websiteIds, limit]);
}

async function removeStaleIssues(retentionDays = 30) {
  const sql = `
    DELETE FROM file_security_issues 
    WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL ? DAY)
  `;
  
  const result = await db.query(sql, [retentionDays]);
  return result.affectedRows || 0;
}

async function getTotalCount(websiteIds = null, severity = null) {
  let sql = 'SELECT COUNT(*) as count FROM file_security_issues WHERE 1=1';
  const params = [];

  if (websiteIds && websiteIds.length > 0) {
    sql += ' AND website_id IN (?)';
    params.push(websiteIds);
  }

  if (severity) {
    sql += ' AND severity = ?';
    params.push(severity);
  }

  const result = await db.query(sql, params);
  return result[0].count;
}

module.exports = {
  createTable,
  create,
  upsertIssue,
  bulkUpsert,
  deleteByFilePath,
  findByWebsite,
  getSummaryByWebsite,
  getSummaryByDateRange,
  getTopFilesByIssueCount,
  removeStaleIssues,
  getTotalCount,
};
