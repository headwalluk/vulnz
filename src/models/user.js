const db = require('../db');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../lib/passwordValidation');
const { validateUsername } = require('../lib/usernameValidation');

async function createTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      max_api_keys INT NOT NULL DEFAULT 1,
      blocked BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await db.query(sql);
}

async function createUser(username, password, roleNames, blocked, max_api_keys) {
  const usernameValidation = validateUsername(username);
  if (!usernameValidation.isValid) {
    throw new Error(usernameValidation.errors.join(' '));
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
  const finalBlocked = blocked !== undefined ? blocked : false;
  const result = await db.query('INSERT INTO users (username, password, blocked, max_api_keys) VALUES (?, ?, ?, ?)', [username, hashedPassword, finalBlocked, finalMaxApiKeys]);
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

  const [userRow] = await db.query('SELECT id, username, blocked, max_api_keys FROM users WHERE id = ?', [userId]);
  const roles = await getRoles(userId);
  return {
    ...userRow,
    id: parseInt(userRow.id, 10),
    blocked: Boolean(userRow.blocked),
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

async function updateUser(userId, { username, password, roles, blocked, max_api_keys }) {
  if (password) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      throw new Error(passwordValidation.errors.join(' '));
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);
  }

  if (username) {
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.isValid) {
      throw new Error(usernameValidation.errors.join(' '));
    }
    await db.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]);
  }

  if (blocked !== undefined) {
    await db.query('UPDATE users SET blocked = ? WHERE id = ?', [blocked, userId]);
  }

  if (max_api_keys !== undefined) {
    let maxApiKeys = parseInt(max_api_keys, 10);
    if (process.env.MAX_API_KEYS_PER_USER) {
      maxApiKeys = Math.min(maxApiKeys, parseInt(process.env.MAX_API_KEYS_PER_USER, 10));
    }
    await db.query('UPDATE users SET max_api_keys = ? WHERE id = ?', [maxApiKeys, userId]);
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

async function deleteUser(userId) {
  await db.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
  await db.query('DELETE FROM users WHERE id = ?', [userId]);
}

module.exports = {
  createTable,
  createUser,
  deleteUser,
  getRoles,
  findUserByUsername,
  findUserById,
  updatePassword,
  updateUser,
};
