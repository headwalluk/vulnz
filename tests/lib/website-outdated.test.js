/**
 * Website.findOutdatedWordPress() / findOutdatedPhp() compare versions numerically, not as strings.
 */

const { createTestDatabase, initializeSchema, createTestUser, createTestWebsite, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const Website = require('../../src/models/website');

describe('outdated WordPress and PHP', () => {
  let db;
  let ownerId;
  let otherOwnerId;

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    ownerId = (await createTestUser(db, { username: 'owner@example.com' })).id;
    otherOwnerId = (await createTestUser(db, { username: 'other@example.com' })).id;

    const sites = [
      ['two-digit-minor.example.com', '6.10.0', '8.10.1', ownerId],
      ['old.example.com', '6.4.2', '7.4.33', ownerId],
      ['older.example.com', '5.9', '7.2', ownerId],
      ['current.example.com', '6.7.1', '8.1', ownerId],
      ['unparseable.example.com', 'trunk', 'unknown', ownerId],
      ['someone-else.example.com', '6.0', '7.0', otherOwnerId],
    ];
    for (const [domain, wordpressVersion, phpVersion, userId] of sites) {
      await createTestWebsite(db, { domain, user_id: userId, wordpress_version: wordpressVersion, php_version: phpVersion });
    }
    await createTestWebsite(db, { domain: 'never-reported.example.com', user_id: ownerId, wordpress_version: null, php_version: null });
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  const domainsOf = (rows) => rows.map((row) => row.domain);

  test('6.10.0 is not older than 6.7.1, and results run oldest first', async () => {
    const outdated = await Website.findOutdatedWordPress('6.7.1', ownerId);

    expect(domainsOf(outdated)).toEqual(['older.example.com', 'old.example.com']);
  });

  test('PHP 8.10 is not older than 8.1', async () => {
    const outdated = await Website.findOutdatedPhp('8.1', ownerId);

    expect(domainsOf(outdated)).toEqual(['older.example.com', 'old.example.com']);
  });

  test('a null owner covers every website', async () => {
    const outdated = await Website.findOutdatedWordPress('6.7.1');

    expect(domainsOf(outdated)).toContain('someone-else.example.com');
  });

  test('unparseable and missing versions are never reported as outdated', async () => {
    const outdated = await Website.findOutdatedWordPress('6.7.1');

    expect(domainsOf(outdated)).not.toContain('unparseable.example.com');
    expect(domainsOf(outdated)).not.toContain('never-reported.example.com');
  });
});
