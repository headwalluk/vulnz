const db = require('../db');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../lib/passwordValidation');
const { validateEmailAddress } = require('../lib/emailValidation');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      reporting_email VARCHAR(255) NULL,
      max_api_keys INT NOT NULL DEFAULT 1,
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      paused BOOLEAN NOT NULL DEFAULT FALSE,
      last_summary_sent_at DATETIME NULL
    )
  `;
  await db.query(sql);
}

async function createUser(
  username,
  password,
  roleNames,
  blocked,
  max_api_keys,
  reporting_weekday,
  reporting_email,
  last_summary_sent_at,
  enable_white_label,
  white_label_html,
  paused
) {
  const emailValidation = validateEmailAddress(username);
  if (!emailValidation.isValid) {
    throw new Error(emailValidation.errors.join(' '));
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    throw new Error(passwordValidation.errors.join(' '));
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  let finalMaxApiKeys = max_api_keys !== undefined ? parseInt(max_api_keys, 10) : 1;
  if (process.env.MAX_API_KEYS_PER_USER) {
    finalMaxApiKeys = Math.min(finalMaxApiKeys, parseInt(process.env.MAX_API_KEYS_PER_USER, 10));
  }
  const finalBlocked = blocked !== undefined && blocked !== null ? blocked : false;
  const finalPaused = paused !== undefined && paused !== null ? paused : false;
  const finalReportingWeekday = reporting_weekday !== undefined ? reporting_weekday : '';
  const finalEnableWhiteLabel = enable_white_label ? true : false;
  const finalWhiteLabelHtml = white_label_html !== undefined ? white_label_html : null;
  const result = await db.query(
    'INSERT INTO users (username, password, blocked, paused, max_api_keys, reporting_weekday, reporting_email, last_summary_sent_at, enable_white_label, white_label_html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, finalBlocked, finalPaused, finalMaxApiKeys, finalReportingWeekday, reporting_email, last_summary_sent_at, finalEnableWhiteLabel, finalWhiteLabelHtml]
  );
  const userId = result.insertId;

  let finalRoleNames = roleNames || [];
  if (process.env.SETUP_MODE === 'true') {
    finalRoleNames.push('user', 'administrator');
  }

  if (finalRoleNames.length > 0) {
    const uniqueRoleNames = [...new Set(finalRoleNames)];
    for (const roleName of uniqueRoleNames) {
      const [role] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
      if (role) {
        await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id]);
      } else {
        console.warn(`Role '${roleName}' not found.`);
      }
    }
  }

  const [userRow] = await db.query(
    'SELECT id, username, blocked, paused, max_api_keys, reporting_weekday, reporting_email, last_summary_sent_at, enable_white_label, white_label_html FROM users WHERE id = ?',
    [userId]
  );
  const roles = await getRoles(userId);
  return {
    ...userRow,
    id: parseInt(userRow.id, 10),
    blocked: Boolean(userRow.blocked),
    paused: Boolean(userRow.paused),
    enable_white_label: Boolean(userRow.enable_white_label),
    roles,
  };
}

async function findUserByUsername(username) {
  const [user] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
  return user;
}

async function findUserById(userId) {
  const [user] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return user;
}

async function updatePassword(userId, newPassword) {
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    throw new Error(passwordValidation.errors.join(' '));
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
}

async function updateUser(
  userId,
  { username, password, roles, blocked, paused, max_api_keys, reporting_weekday, reporting_email, last_summary_sent_at, enable_white_label, white_label_html }
) {
  if (password) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new Error(passwordValidation.errors.join(' '));
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
  }

  if (username) {
    const emailValidation = validateEmailAddress(username);
    if (!emailValidation.isValid) {
      throw new Error(emailValidation.errors.join(' '));
    }
    await db.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
  }

  if (blocked !== undefined) {
    await db.query('UPDATE users SET blocked = ? WHERE id = ?', [blocked, userId]);
  }

  if (paused !== undefined) {
    await db.query('UPDATE users SET paused = ? WHERE id = ?', [paused, userId]);
  }

  if (max_api_keys !== undefined) {
    let maxApiKeys = parseInt(max_api_keys, 10);
    if (process.env.MAX_API_KEYS_PER_USER) {
      maxApiKeys = Math.min(maxApiKeys, parseInt(process.env.MAX_API_KEYS_PER_USER, 10));
    }
    await db.query('UPDATE users SET max_api_keys = ? WHERE id = ?', [maxApiKeys, userId]);
  }

  if (reporting_weekday !== undefined) {
    await db.query('UPDATE users SET reporting_weekday = ? WHERE id = ?', [reporting_weekday, userId]);
  }

  if (reporting_email !== undefined) {
    await db.query('UPDATE users SET reporting_email = ? WHERE id = ?', [reporting_email, userId]);
  }

  if (last_summary_sent_at !== undefined) {
    await db.query('UPDATE users SET last_summary_sent_at = ? WHERE id = ?', [last_summary_sent_at, userId]);
  }

  if (enable_white_label !== undefined) {
    await db.query('UPDATE users SET enable_white_label = ? WHERE id = ?', [enable_white_label, userId]);
  }

  if (white_label_html !== undefined) {
    await db.query('UPDATE users SET white_label_html = ? WHERE id = ?', [white_label_html, userId]);
  }

  if (roles) {
    await db.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    for (const roleName of roles) {
      const [role] = await db.query('SELECT id FROM roles WHERE name = ?', [roleName]);
      if (role) {
        await db.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, role.id]);
      } else {
        console.warn(`Role '${roleName}' not found.`);
      }
    }
  }
}

const getRoles = async (userId) => {
  const rows = await db.query('SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [userId]);
  return Array.isArray(rows) ? rows.map((row) => row.name) : [];
};

async function updateLastSummarySentAt(userId) {
  await db.query('UPDATE users SET last_summary_sent_at = ? WHERE id = ?', [new Date(), userId]);
}

async function findUsersForWeeklyReport(dayOfWeek, batchSize) {
  const query = `
    SELECT * FROM users
    WHERE reporting_weekday = ?
    AND (last_summary_sent_at IS NULL OR DATE(last_summary_sent_at) < CURDATE())
    AND blocked = 0
    AND paused = 0
    LIMIT ?
  `;

  return db.query(query, [dayOfWeek, batchSize]);
}

async function countUsersDueForWeeklyReport(dayOfWeek) {
  const query = `
    SELECT COUNT(*) as count FROM users
    WHERE reporting_weekday = ?
    AND (last_summary_sent_at IS NULL OR DATE(last_summary_sent_at) < CURDATE())
    AND blocked = 0
    AND paused = 0
  `;
  const [result] = await db.query(query, [dayOfWeek]);
  return result.count;
}

async function deleteUser(userId) {
  await db.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  await db.query('DELETE FROM users WHERE id = ?', [userId]);
}

async function listAll() {
  const users = await db.query('SELECT id, username, blocked, paused FROM users ORDER BY id ASC');
  const result = [];
  for (const u of users) {
    const roles = await getRoles(u.id);
    result.push({
      id: parseInt(u.id, 10),
      username: u.username,
      blocked: Boolean(u.blocked),
      paused: Boolean(u.paused),
      roles,
    });
  }
  return result;
}

module.exports = {
  createTable,
  createUser,
  deleteUser,
  getRoles,
  findUserByUsername,
  findUserById,
  listAll,
  updatePassword,
  updateUser,
  updateLastSummarySentAt,
  findUsersForWeeklyReport,
  countUsersDueForWeeklyReport,
};
