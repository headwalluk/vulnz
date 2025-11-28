# Development Setup

This guide covers setting up VULNZ for local development.

## Requirements

- **MySQL/MariaDB**: Any recent version should be fine.
- **Node.js**: v22+ recommended. Tested with Node v22.21.0
- **BASH**: Required if you want to use the tools to backup, restore and pull from wordfence.com.

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/headwalluk/vulnz
   cd vulnz
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure your environment:**
   - Copy `env.sample` to `.env`:
     ```bash
     cp env.sample .env
     ```
   - Edit the `.env` file and set up your MySQL/MariaDB database credentials.
   - **Generate a secure SESSION_SECRET:**
     ```bash
     bash scripts/generate-session-secret.sh
     ```
     This automatically creates a cryptographically secure 48-character random string.

## Scripts (dev vs prod)

- Development (serves `public/` with separate assets and automatic restarts):

  ```bash
  npm run dev
  ```

- Build production artifacts (bundled/minified CSS/JS, validated/minified HTML into `dist/`):

  ```bash
  npm run build
  ```

  This generates:
  - `dist/build/css/app.bundle.min.css`
  - `dist/build/js/core.bundle.min.js`
  - `dist/build/js/pages/*.bundle.min.js`
  - Transformed HTML files in `dist/` referencing the bundles
  - Copied static files like `partials/` and `favicon.png`

  The server auto-selects `public` in development and `dist` in production based on `NODE_ENV`.

- Start in production (requires a prior build; will exit with a helpful error if `dist` is missing):

  ```bash
  npm run start
  ```

- Clean the build output:
  ```bash
  npm run clean
  ```

## Initial Setup (Setup Mode)

1. In your `.env` file, set `SETUP_MODE=true`.
2. Start the application:
   ```bash
   npm run dev
   ```
3. Open your browser and navigate to the application (e.g., `http://localhost:3000`).
4. Register a new user account. This first account will automatically be granted administrator privileges.

## Switch out of SETUP_MODE

**IMPORTANT:** After creating your administrator account, stop the application and change `SETUP_MODE` to `false` in your `.env` file. This is a critical security step to ensure that subsequent user registrations do not receive administrator privileges.

You can also choose to disable new user registrations entirely by setting `REGISTRATION_ENABLED=false`.

## Restart the application

```bash
npm run dev
```
