const fs = require('fs');
const path = require('path');
const db = require('../db');

const migrationsDir = path.join(__dirname);

const createMigrationsTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getRanMigrations = async () => {
  const result = await db.query('SELECT name FROM migrations');
  return Array.isArray(result) ? result.map((row) => row.name) : [];
};

const runMigration = async (migrationName) => {
  const migration = require(path.join(migrationsDir, migrationName));
  await migration.up();
  await db.query('INSERT INTO migrations (name) VALUES (?)', [migrationName]);
};

const run = async () => {
  await createMigrationsTable();
  const ranMigrations = await getRanMigrations();
  const migrationFiles = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.js') && file !== 'index.js');

  for (const file of migrationFiles) {
    if (!ranMigrations.includes(file)) {
      await runMigration(file);
    }
  }
};

module.exports = { run };
