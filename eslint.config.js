const globals = require('globals');
const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['public/vendor/**', 'dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jquery,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Role names come from the constants in src/models/role.js
    files: ['src/**/*.js', 'bin/**/*.js'],
    ignores: ['src/models/role.js', 'src/migrations/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='administrator']",
          message: 'Use ROLE_ADMINISTRATOR from src/models/role.js.',
        },
      ],
    },
  },
  {
    // Jest test files
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
];
