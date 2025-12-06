const db = require('../db');

async function createTable() {
  // Table is created via migration
  // This function is kept for consistency with other models
}

async function create(websiteId, componentId, changeType, oldReleaseId, newReleaseId, changedByUserId, changedVia = 'api') {
  const sql = `
    INSERT INTO component_changes 
    (website_id, component_id, change_type, old_release_id, new_release_id, changed_by_user_id, changed_via)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  
  const result = await db.query(sql, [
    websiteId,
    componentId,
    changeType,
    oldReleaseId || null,
    newReleaseId || null,
    changedByUserId || null,
    changedVia
  ]);
  
  return result.insertId;
}

async function bulkCreate(changes) {
  if (!changes || changes.length === 0) {
    return [];
  }

  const sql = `
    INSERT INTO component_changes 
    (website_id, component_id, change_type, old_release_id, new_release_id, changed_by_user_id, changed_via)
    VALUES ?
  `;

  const values = changes.map(change => [
    change.websiteId,
    change.componentId,
    change.changeType,
    change.oldReleaseId || null,
    change.newReleaseId || null,
    change.changedByUserId || null,
    change.changedVia || 'api'
  ]);

  const result = await db.query(sql, [values]);
  return result.insertId;
}

async function recordChanges(websiteId, oldComponents, newComponents, userId = null, changedVia = 'api') {
  // oldComponents and newComponents are arrays of {component_id, release_id, slug, version}
  const changes = [];
  
  // Create maps for quick lookup
  const oldMap = new Map();
  for (const comp of oldComponents) {
    const key = `${comp.component_id}`;
    oldMap.set(key, comp);
  }

  const newMap = new Map();
  for (const comp of newComponents) {
    const key = `${comp.component_id}`;
    newMap.set(key, comp);
  }

  // Detect additions and updates
  for (const [key, newComp] of newMap) {
    const oldComp = oldMap.get(key);
    
    if (!oldComp) {
      // Component added
      changes.push({
        websiteId,
        componentId: newComp.component_id,
        changeType: 'added',
        oldReleaseId: null,
        newReleaseId: newComp.release_id,
        changedByUserId: userId,
        changedVia
      });
    } else if (oldComp.release_id !== newComp.release_id) {
      // Component updated (version changed)
      changes.push({
        websiteId,
        componentId: newComp.component_id,
        changeType: 'updated',
        oldReleaseId: oldComp.release_id,
        newReleaseId: newComp.release_id,
        changedByUserId: userId,
        changedVia
      });
    }
  }

  // Detect removals
  for (const [key, oldComp] of oldMap) {
    if (!newMap.has(key)) {
      // Component removed
      changes.push({
        websiteId,
        componentId: oldComp.component_id,
        changeType: 'removed',
        oldReleaseId: oldComp.release_id,
        newReleaseId: null,
        changedByUserId: userId,
        changedVia
      });
    }
  }

  // Bulk insert changes
  if (changes.length > 0) {
    await bulkCreate(changes);
  }

  return {
    added: changes.filter(c => c.changeType === 'added').length,
    removed: changes.filter(c => c.changeType === 'removed').length,
    updated: changes.filter(c => c.changeType === 'updated').length,
    total: changes.length
  };
}

async function getRecentChanges(websiteId, limit = 50) {
  const sql = `
    SELECT 
      cc.*,
      c.slug as component_slug,
      c.title as component_title,
      c.component_type_slug,
      r_old.version as old_version,
      r_new.version as new_version,
      u.username as changed_by_username
    FROM component_changes cc
    JOIN components c ON cc.component_id = c.id
    LEFT JOIN releases r_old ON cc.old_release_id = r_old.id
    LEFT JOIN releases r_new ON cc.new_release_id = r_new.id
    LEFT JOIN users u ON cc.changed_by_user_id = u.id
    WHERE cc.website_id = ?
    ORDER BY cc.changed_at DESC
    LIMIT ?
  `;

  return await db.query(sql, [websiteId, limit]);
}

async function getChangesByDateRange(websiteIds, startDate, endDate) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      cc.website_id,
      w.domain,
      cc.change_type,
      c.slug as component_slug,
      c.title as component_title,
      c.component_type_slug,
      r_old.version as old_version,
      r_new.version as new_version,
      cc.changed_at
    FROM component_changes cc
    JOIN websites w ON cc.website_id = w.id
    JOIN components c ON cc.component_id = c.id
    LEFT JOIN releases r_old ON cc.old_release_id = r_old.id
    LEFT JOIN releases r_new ON cc.new_release_id = r_new.id
    WHERE cc.website_id IN (?)
      AND cc.changed_at >= ?
      AND cc.changed_at < ?
    ORDER BY cc.changed_at DESC
  `;

  return await db.query(sql, [websiteIds, startDate, endDate]);
}

async function getChangeSummary(websiteIds, startDate, endDate) {
  if (!websiteIds || websiteIds.length === 0) {
    return [];
  }

  const sql = `
    SELECT 
      w.domain,
      COUNT(CASE WHEN cc.change_type = 'added' THEN 1 END) as added,
      COUNT(CASE WHEN cc.change_type = 'removed' THEN 1 END) as removed,
      COUNT(CASE WHEN cc.change_type = 'updated' THEN 1 END) as updated
    FROM component_changes cc
    JOIN websites w ON cc.website_id = w.id
    WHERE cc.website_id IN (?)
      AND cc.changed_at >= ?
      AND cc.changed_at < ?
    GROUP BY w.id, w.domain
  `;

  return await db.query(sql, [websiteIds, startDate, endDate]);
}

async function removeOldChanges(retentionDays = 365) {
  const sql = `
    DELETE FROM component_changes 
    WHERE changed_at < DATE_SUB(NOW(), INTERVAL ? DAY)
  `;
  
  const result = await db.query(sql, [retentionDays]);
  return result.affectedRows || 0;
}

module.exports = {
  createTable,
  create,
  bulkCreate,
  recordChanges,
  getRecentChanges,
  getChangesByDateRange,
  getChangeSummary,
  removeOldChanges,
};
