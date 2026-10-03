/**
 * user.addRole() / user.removeRole() against the real model on SQLite.
 */

const { createTestDatabase, initializeSchema, createTestUser, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const user = require('../../src/models/user');
const { ROLE_USER, ROLE_ADMINISTRATOR } = require('../../src/models/role');

describe('user role changes', () => {
  let db;
  let userId;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    userId = (await createTestUser(db, { username: 'roles@example.com', role: ROLE_USER })).id;
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  test('adds a role once', async () => {
    expect(await user.addRole(userId, ROLE_ADMINISTRATOR)).toBe(true);
    expect(await user.addRole(userId, ROLE_ADMINISTRATOR)).toBe(false);
    expect((await user.getRoles(userId)).sort()).toEqual([ROLE_ADMINISTRATOR, ROLE_USER]);
  });

  test('rejects an unknown role', async () => {
    await expect(user.addRole(userId, 'superuser')).rejects.toThrow(/Unknown role/);
  });

  test('removes a role, and reports one the user lacks', async () => {
    expect(await user.removeRole(userId, ROLE_ADMINISTRATOR)).toBe(true);
    expect(await user.removeRole(userId, ROLE_ADMINISTRATOR)).toBe(false);
    expect(await user.getRoles(userId)).toEqual([ROLE_USER]);
  });

  test("refuses to remove the user's last role", async () => {
    await expect(user.removeRole(userId, ROLE_USER)).rejects.toThrow(/only role/);
    expect(await user.getRoles(userId)).toEqual([ROLE_USER]);
  });
});
