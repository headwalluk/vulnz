/**
 * Jest configuration
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test match patterns
  testMatch: ['**/tests/**/*.test.js'],

  // Coverage configuration
  collectCoverageFrom: ['src/**/*.js', '!src/migrations/**', '!src/index.js'],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],

  // Timeout for tests
  testTimeout: 10000,

  // Force exit after all tests complete (open handles from session stores, etc.)
  forceExit: true,

  // Verbose output
  verbose: true,
};
