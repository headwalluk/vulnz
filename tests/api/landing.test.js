const request = require('supertest');
const express = require('express');
const landingRoute = require('../../src/routes/landing');
const pkg = require('../../package.json');

describe('Landing Page', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use('/', landingRoute);
  });

  describe('HTML response', () => {
    test('returns HTML by default for browser requests', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html').expect(200).expect('Content-Type', /html/);

      expect(response.text).toContain('<title>VULNZ API</title>');
      expect(response.text).toContain('VULNZ API');
      expect(response.text).toContain(pkg.version);
      expect(response.text).toContain('Self-hosted vulnerability database');
      expect(response.text).toContain('System Operational');
    });

    test('includes all four navigation buttons', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html').expect(200);

      expect(response.text).toContain('href="/api/ping"');
      expect(response.text).toContain('Health Check');
      expect(response.text).toContain('github.com');
      expect(response.text).toContain('GitHub Repo');
      expect(response.text).toContain('href="/doc"');
      expect(response.text).toContain('API Documentation');
      expect(response.text).toContain('href="/openapi.json"');
      expect(response.text).toContain('OpenAPI Spec');
    });

    test('includes favicon links for both SVG and PNG', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html').expect(200);

      expect(response.text).toContain('rel="icon" type="image/svg+xml" href="/icon.svg"');
      expect(response.text).toContain('rel="icon" type="image/png" href="/icon.png"');
    });

    test('inlines the dark-mode vulnz logo SVG', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html').expect(200);

      expect(response.text).toContain('<svg class="logo"');
      expect(response.text).toContain('vulnz</text>');
      expect(response.text).toContain('#10b981'); // green accent dot
    });

    test('reads version dynamically from package.json', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html').expect(200);

      expect(response.text).toContain(`Version ${pkg.version}`);
    });
  });

  describe('JSON response', () => {
    test('returns JSON when Accept: application/json', async () => {
      const response = await request(app).get('/').set('Accept', 'application/json').expect(200).expect('Content-Type', /json/);

      expect(response.body).toEqual({
        name: 'VULNZ API',
        version: pkg.version,
        tagline: expect.stringContaining('Self-hosted'),
        status: 'operational',
        links: {
          health: '/api/ping',
          github: expect.stringContaining('github.com'),
          swaggerUi: '/doc',
          openapi: '/openapi.json',
        },
      });
    });

    test('JSON response version matches package.json', async () => {
      const response = await request(app).get('/').set('Accept', 'application/json').expect(200);

      expect(response.body.version).toBe(pkg.version);
    });

    test('JSON links point to the correct paths', async () => {
      const response = await request(app).get('/').set('Accept', 'application/json').expect(200);

      expect(response.body.links.health).toBe('/api/ping');
      expect(response.body.links.swaggerUi).toBe('/doc');
      expect(response.body.links.openapi).toBe('/openapi.json');
      expect(response.body.links.github).not.toMatch(/^git\+/);
      expect(response.body.links.github).not.toMatch(/\.git$/);
    });
  });

  describe('content negotiation', () => {
    test('prefers HTML when both types are accepted with higher q for HTML', async () => {
      const response = await request(app).get('/').set('Accept', 'text/html,application/json;q=0.9').expect(200);

      expect(response.headers['content-type']).toMatch(/html/);
    });

    test('prefers JSON when both types are accepted with higher q for JSON', async () => {
      const response = await request(app).get('/').set('Accept', 'application/json,text/html;q=0.5').expect(200);

      expect(response.headers['content-type']).toMatch(/json/);
    });
  });
});
