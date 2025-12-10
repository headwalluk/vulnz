require('dotenv').config({ path: '../../.env', quiet: true });

module.exports = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: 'Z', // Use UTC for all connections (WordPress.org times are in GMT/UTC)
};
