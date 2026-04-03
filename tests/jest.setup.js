/**
 * Jest setup file
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.SESSION_SECRET = 'test-session-secret-for-testing-only';
process.env.PORT = '0'; // Random port for testing
process.env.REFERENCE_UPDATE_METHOD = 'disabled';

// Rate limiting: use permissive defaults for tests to avoid 429s
process.env.UNAUTH_SEARCH_LIMIT_PER_SECOND = '0';
process.env.AUTH_RATE_LIMIT_WINDOW_MINUTES = '15';
process.env.AUTH_RATE_LIMIT_MAX = '1000';

// Set dummy database credentials to prevent real DB connection attempts
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';
process.env.DB_PORT = '3306';

// Increase timeout for database operations
jest.setTimeout(10000);

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };
