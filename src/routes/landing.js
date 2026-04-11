const express = require('express');
const router = express.Router();
const pkg = require('../../package.json');

const NAME = 'VULNZ API';
const TAGLINE = 'Self-hosted vulnerability database for WordPress plugins, themes, and npm packages.';
const REPO_URL = (pkg.repository && pkg.repository.url ? pkg.repository.url : 'https://github.com/headwalluk/vulnz').replace(/^git\+/, '').replace(/\.git$/, '');

const LINKS = {
  health: '/api/ping',
  github: REPO_URL,
  swaggerUi: '/doc',
  openapi: '/openapi.json',
};

function buildJson() {
  return {
    name: NAME,
    version: pkg.version,
    tagline: TAGLINE,
    status: 'operational',
    links: LINKS,
  };
}

function buildHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${NAME}</title>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0f172b;
    --card: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --muted: #94a3b8;
    --brand: #3c82f5;
    --accent: #10b982;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100vh;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 2.5rem 2rem;
    max-width: 480px;
    width: 100%;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  }
  .logo {
    display: block;
    margin: 0 auto 0.5rem;
    height: 48px;
    width: auto;
  }
  h1 {
    margin: 0.5rem 0 0.25rem;
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .version {
    color: var(--muted);
    font-size: 0.875rem;
    margin-bottom: 1.25rem;
  }
  .tagline {
    color: var(--muted);
    font-size: 0.95rem;
    line-height: 1.55;
    margin: 0 0 1.5rem;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(16, 185, 130, 0.12);
    color: var(--accent);
    padding: 0.5rem 1rem;
    border-radius: 999px;
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 1.75rem;
  }
  .pill::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }
  .btn {
    display: block;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    background: rgba(255, 255, 255, 0.02);
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .btn:hover, .btn:focus-visible {
    background: rgba(60, 130, 245, 0.12);
    border-color: var(--brand);
    color: var(--brand);
    outline: none;
  }
  footer {
    color: var(--muted);
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }
</style>
</head>
<body>
<main class="card">
  <svg class="logo" viewBox="0 0 134.9 39.54" xmlns="http://www.w3.org/2000/svg" aria-label="vulnz">
    <g transform="translate(-2.09375,-5)">
      <text x="2" y="44" font-family="Inter, system-ui, -apple-system, sans-serif" font-weight="800" font-size="48" fill="#f8fafc" letter-spacing="-2.5">vulnz</text>
      <circle cx="130" cy="12" r="7" fill="#10b981" />
    </g>
  </svg>
  <h1>${NAME}</h1>
  <p class="version">Version ${pkg.version}</p>
  <p class="tagline">${TAGLINE}</p>
  <span class="pill">System Operational</span>
  <nav class="buttons">
    <a class="btn" href="${LINKS.health}">Health Check</a>
    <a class="btn" href="${LINKS.github}" rel="noopener">GitHub Repo</a>
    <a class="btn" href="${LINKS.swaggerUi}">API Documentation</a>
    <a class="btn" href="${LINKS.openapi}">OpenAPI Spec</a>
  </nav>
  <footer>&copy; ${new Date().getFullYear()} Vulnz. All rights reserved.</footer>
</main>
</body>
</html>`;
}

router.get('/', (req, res) => {
  if (req.accepts(['html', 'json']) === 'json') {
    return res.json(buildJson());
  }
  res.type('html').send(buildHtml());
});

module.exports = router;
