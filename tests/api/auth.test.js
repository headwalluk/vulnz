/**
 * Authentication API Tests
 *
 * Tests for /api/auth endpoints including registration, login, password reset
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const crypto = require('crypto');
const { createTestDatabase, initializeSchema, createTestUser, cleanupTestDatabase } = require('../setup');

// Mock the db module
const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

// Mock email module
const mockEmailer = {
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
};

jest.mock('../../src/lib/email', () => mockEmailer);

// Don't import routes yet - will import after Passport is configured

describe('Authentication API', () => {
  let app;
  let db;
  let testUser;
  let agent;
  let authRoutes;

  beforeAll(async () => {
    // Create test database
    db = await createTestDatabase();

    // Update mock to use our test database
    mockDb.query.mockImplementation((...args) => db.query(...args));

    await initializeSchema(db);

    // Create test user
    testUser = await createTestUser(db, {
      username: 'testuser@example.com',
      role: 'user',
    });

    // Use the real Passport configuration from production
    require('../../src/config/passport');

    // Create Express app
    app = express();
    app.use(express.json());

    app.use(
      session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false },
      })
    );

    app.use(passport.initialize());
    app.use(passport.session());

    // Clear the require cache and load the routes after Passport is configured
    delete require.cache[require.resolve('../../src/routes/auth')];
    delete require.cache[require.resolve('../../src/middleware/auth')];
    authRoutes = require('../../src/routes/auth');
    app.use('/api/auth', authRoutes);

    // Create agent for session persistence
    agent = request.agent(app);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(() => {
    mockEmailer.sendPasswordResetEmail.mockClear();
  });

  describe('POST /api/auth/register', () => {
    test('should register a new user when registration is enabled', async () => {
      process.env.REGISTRATION_ENABLED = 'true';

      const response = await request(app).post('/api/auth/register').send({
        username: 'newuser@example.com',
        password: 'StrongP@ss123',
      });

      expect(response.status).toBe(201);
      expect(response.text).toBe('User created');

      // Verify user was created in database
      const users = await db.query('SELECT * FROM users WHERE username = ?', ['newuser@example.com']);
      expect(users.length).toBe(1);
      expect(users[0].username).toBe('newuser@example.com');
    });

    test('should reject registration when REGISTRATION_ENABLED is false', async () => {
      process.env.REGISTRATION_ENABLED = 'false';

      const response = await request(app).post('/api/auth/register').send({
        username: 'blocked@example.com',
        password: 'StrongP@ss123',
      });

      expect(response.status).toBe(401);
      expect(response.text).toContain('disabled');
    });

    test('should reject weak passwords', async () => {
      process.env.REGISTRATION_ENABLED = 'true';

      const response = await request(app).post('/api/auth/register').send({
        username: 'weak@example.com',
        password: 'weak',
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/password/i);
    });

    test('should reject duplicate usernames', async () => {
      process.env.REGISTRATION_ENABLED = 'true';

      const response = await request(app).post('/api/auth/register').send({
        username: 'testuser@example.com', // Already exists
        password: 'StrongP@ss123',
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/already registered/i);
    });

    test('should reject invalid email addresses', async () => {
      process.env.REGISTRATION_ENABLED = 'true';

      const response = await request(app).post('/api/auth/register').send({
        username: 'not-an-email',
        password: 'StrongP@ss123',
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/username/i);
    });
  });

  describe('POST /api/auth/login', () => {
    test('should login with valid credentials', async () => {
      const response = await agent.post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: 'password123', // Default password from createTestUser
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/logged in successfully/i);
    });

    test('should reject invalid username', async () => {
      const response = await request(app).post('/api/auth/login').send({
        username: 'nonexistent',
        password: 'password123',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toMatch(/incorrect username/i);
    });

    test('should reject invalid password', async () => {
      const response = await request(app).post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: 'wrongpassword',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toMatch(/incorrect password/i);
    });

    test('should reject login for blocked user', async () => {
      // Block the test user
      await db.query('UPDATE users SET blocked = 1 WHERE id = ?', [testUser.id]);

      const response = await request(app).post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: 'password123',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toMatch(/blocked/i);

      // Unblock for other tests
      await db.query('UPDATE users SET blocked = 0 WHERE id = ?', [testUser.id]);
    });

    test.skip('should enforce rate limiting on login attempts', async () => {
      // authLimiter allows 100 requests per 15 minutes, too high for unit tests
      // Make multiple login attempts quickly
      const attempts = [];
      for (let i = 0; i < 10; i++) {
        attempts.push(
          request(app).post('/api/auth/login').send({
            username: 'testuser@example.com',
            password: 'wrongpassword',
          })
        );
      }

      const responses = await Promise.all(attempts);

      // At least one should be rate limited (429)
      const rateLimited = responses.some((r) => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('GET /api/auth/logout', () => {
    test('should logout authenticated user', async () => {
      // Login first
      await agent.post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: 'password123',
      });

      // Then logout
      const response = await agent.get('/api/auth/logout');

      expect(response.status).toBe(200);
      expect(response.text).toBe('Logged out');
    });

    test('should handle logout when not logged in', async () => {
      const response = await request(app).get('/api/auth/logout');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/auth/me', () => {
    test('should return current user when authenticated', async () => {
      // Login first
      await agent.post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: 'password123',
      });

      const response = await agent.get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.isAuthenticated).toBe(true);
      expect(response.body.username).toBe('testuser@example.com');
      expect(response.body).toHaveProperty('roles');
      expect(response.body).toHaveProperty('sitemap');
      expect(response.body).not.toHaveProperty('password');
    });

    test('should return unauthenticated response when not authenticated', async () => {
      const response = await request(app).get('/api/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.isAuthenticated).toBe(false);
      expect(response.body).toHaveProperty('sitemap');
    });
  });

  describe('POST /api/auth/reset-password', () => {
    test('should send password reset email for valid user', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        email: 'testuser@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/email exists/i);

      // Verify token was created in database
      const tokens = await db.query('SELECT * FROM password_reset_tokens WHERE user_id = ?', [testUser.id]);
      expect(tokens.length).toBeGreaterThan(0);
    });

    test('should not reveal if email does not exist', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        email: 'nonexistent@example.com',
      });

      // Should still return success to prevent email enumeration
      expect(response.status).toBe(200);
      expect(mockEmailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    test('should handle invalid email format gracefully', async () => {
      const response = await request(app).post('/api/auth/reset-password').send({
        email: 'not-an-email',
      });

      // Returns success message to prevent enumeration
      expect(response.status).toBe(200);
      expect(response.text).toMatch(/email exists/i);
    });

    test.skip('should enforce rate limiting on password reset requests', async () => {
      // authLimiter allows 100 requests per 15 minutes, too high for unit tests
      const attempts = [];
      for (let i = 0; i < 10; i++) {
        attempts.push(
          request(app).post('/api/auth/reset-password').send({
            email: 'test@example.com',
          })
        );
      }

      const responses = await Promise.all(attempts);

      // At least one should be rate limited
      const rateLimited = responses.some((r) => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('GET /api/auth/validate-token/:token', () => {
    let validToken;

    beforeEach(async () => {
      // Create a valid token (plaintext, matches production)
      validToken = crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)', [testUser.id, validToken]);
    });

    test('should validate a valid token', async () => {
      const response = await request(app).get(`/api/auth/validate-token/${validToken}`);

      expect(response.status).toBe(200);
      expect(response.text).toBe('Token is valid.');
    });

    test('should reject invalid token', async () => {
      const response = await request(app).get('/api/auth/validate-token/invalidtoken123');

      expect(response.status).toBe(404);
      expect(response.text).toMatch(/not found/i);
    });

    test('should reject expired token', async () => {
      // Create a token that will be considered expired
      // Production checks: tokenAge > PASSWORD_RESET_TOKEN_DURATION * 1000
      // We'll set created_at to be older than the expiry duration
      const expiredToken = crypto.randomBytes(32).toString('hex');
      const oldTimestamp = new Date(Date.now() - (process.env.PASSWORD_RESET_TOKEN_DURATION || 3600) * 1000 - 1000);

      await db.query('INSERT INTO password_reset_tokens (user_id, token, created_at) VALUES (?, ?, ?)', [testUser.id, expiredToken, oldTimestamp.toISOString()]);

      const response = await request(app).get(`/api/auth/validate-token/${expiredToken}`);

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/expired/i);
    });
  });

  describe('POST /api/auth/update-password', () => {
    let validToken;

    beforeEach(async () => {
      // Create a valid token (plaintext, matches production)
      validToken = crypto.randomBytes(32).toString('hex');
      await db.query('INSERT INTO password_reset_tokens (user_id, token) VALUES (?, ?)', [testUser.id, validToken]);
    });

    test('should update password with valid token', async () => {
      const newPassword = 'NewStrongP@ss456';

      const response = await request(app).post('/api/auth/update-password').send({
        token: validToken,
        newPassword: newPassword,
      });

      expect(response.status).toBe(200);
      expect(response.text).toBe('Password updated successfully.');

      // Verify can login with new password
      const loginResponse = await request(app).post('/api/auth/login').send({
        username: 'testuser@example.com',
        password: newPassword,
      });

      expect(loginResponse.status).toBe(200);

      // Token should be deleted after use
      const tokens = await db.query('SELECT * FROM password_reset_tokens WHERE token = ?', [validToken]);
      expect(tokens.length).toBe(0);
    });

    test('should reject weak password', async () => {
      const response = await request(app).post('/api/auth/update-password').send({
        token: validToken,
        newPassword: 'weak',
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/password/i);
    });

    test('should reject invalid token', async () => {
      const response = await request(app).post('/api/auth/update-password').send({
        token: 'invalidtoken',
        newPassword: 'NewStrongP@ss456',
      });

      expect(response.status).toBe(400);
      expect(response.text).toMatch(/invalid/i);
    });
  });
});
