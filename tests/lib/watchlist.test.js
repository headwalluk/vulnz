/**
 * Watchlist builder tests (M12)
 *
 * Covers the static ∪ top-N-by-install-count construction, the
 * rank-then-filter-unwatchable rule, blind-spot reporting, on-demand
 * availability probing, and priority-lane application.
 */

const { createTestDatabase, initializeSchema, createTestUser, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const watchlist = require('../../src/lib/watchlist');
const appSetting = require('../../src/models/appSetting');

let db;
let userId;

async function addComponent(slug, wporgAvailable) {
  const result = await db.query('INSERT INTO components (slug, component_type_slug, title, wporg_available) VALUES (?, ?, ?, ?)', [slug, 'wordpress-plugin', slug, wporgAvailable]);
  return result.insertId;
}

async function addWebsite(domain, isDev) {
  const result = await db.query('INSERT INTO websites (user_id, domain, title, is_dev) VALUES (?, ?, ?, ?)', [userId, domain, domain, isDev ? 1 : 0]);
  return result.insertId;
}

async function installOn(componentId, websiteIds) {
  const rel = await db.query('INSERT INTO releases (component_id, version) VALUES (?, ?)', [componentId, '1.0.0']);
  const releaseId = rel.insertId;
  for (const websiteId of websiteIds) {
    await db.query('INSERT INTO website_components (website_id, release_id) VALUES (?, ?)', [websiteId, releaseId]);
  }
}

async function priorityOf(slug) {
  const rows = await db.query('SELECT sync_priority_slug FROM components WHERE slug = ?', [slug]);
  return rows[0].sync_priority_slug;
}

describe('watchlist.buildWatchlist', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);

    const user = await createTestUser(db, { username: 'owner@example.com', role: 'user' });
    userId = user.id;

    // Two production sites and one dev site
    const prod1 = await addWebsite('prod1.example', false);
    const prod2 = await addWebsite('prod2.example', false);
    const dev1 = await addWebsite('dev1.example', true);

    // popular-a: available, 2 prod installs, also on the static list
    const popularA = await addComponent('popular-a', 1);
    await installOn(popularA, [prod1, prod2]);

    // premium-x: NOT on wordpress.org, 2 prod installs — a blind spot
    const premiumX = await addComponent('premium-x', 0);
    await installOn(premiumX, [prod1, prod2]);

    // popular-b: available, 1 prod install
    const popularB = await addComponent('popular-b', 1);
    await installOn(popularB, [prod1]);

    // unknown-c: availability unknown, 1 prod install — must be probed
    const unknownC = await addComponent('unknown-c', null);
    await installOn(unknownC, [prod2]);

    // dev-only-d: available, installed only on the dev site — excluded
    const devOnlyD = await addComponent('dev-only-d', 1);
    await installOn(devOnlyD, [dev1]);

    await appSetting.set('wporg.watchlist_static', 'popular-a,missing-slug', 'string', null, 'sync', false);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  it('unions the static list with the top-N watchable derived plugins and probes only unknowns', async () => {
    // Probe returns 200 for the one unknown-availability component.
    const fetchImpl = async (url) => {
      if (url.includes('unknown-c')) {
        return { status: 200, json: async () => ({ name: 'Unknown C', version: '1.2.3' }) };
      }
      return { status: 404, json: async () => ({}) };
    };

    const result = await watchlist.buildWatchlist({ fetchImpl, size: 2 });

    // static popular-a + derived popular-b + probed unknown-c
    expect(result.high.sort()).toEqual(['popular-a', 'popular-b', 'unknown-c']);
    // missing static slug + the premium (404) plugin
    expect(result.blindSpots.sort()).toEqual(['missing-slug', 'premium-x']);
    expect(result.derivedCount).toBe(2);
    expect(result.probed).toBe(1); // only unknown-c

    // dev-only plugin never entered the ranking
    expect(result.high).not.toContain('dev-only-d');
  });

  it('applies high priority to the union and leaves everything else low', async () => {
    expect(await priorityOf('popular-a')).toBe('high');
    expect(await priorityOf('popular-b')).toBe('high');
    expect(await priorityOf('unknown-c')).toBe('high');

    expect(await priorityOf('premium-x')).toBe('low');
    expect(await priorityOf('dev-only-d')).toBe('low');
  });

  it('caches the probed availability so a rebuild does not re-probe', async () => {
    const fetchImpl = jest.fn(async () => ({ status: 404, json: async () => ({}) }));
    const result = await watchlist.buildWatchlist({ fetchImpl, size: 2 });
    // unknown-c is now wporg_available = 1 from the first run, so no probe
    expect(result.probed).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('demotes a plugin that drops off the watchlist on rebuild', async () => {
    // Shrink the static list and target size so popular-b falls off
    await appSetting.set('wporg.watchlist_static', 'popular-a', 'string', null, 'sync', false);
    const fetchImpl = async () => ({ status: 404, json: async () => ({}) });
    await watchlist.buildWatchlist({ fetchImpl, size: 1 });

    expect(await priorityOf('popular-a')).toBe('high');
    // Only 1 derived slot; the highest-ranked watchable non-static is popular-b
    // (unknown-c ties on installs but sorts later), so popular-b stays, unknown-c demotes.
    expect(await priorityOf('unknown-c')).toBe('low');
  });
});

describe('watchlist.getStaticWatchlist', () => {
  let db2;
  beforeAll(async () => {
    db2 = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db2.query(...args));
    await initializeSchema(db2);
  });
  afterAll(async () => {
    await cleanupTestDatabase(db2);
  });

  it('lower-cases, trims, and de-duplicates', async () => {
    await appSetting.set('wporg.watchlist_static', ' WooCommerce , elementor,woocommerce ,, ', 'string', null, 'sync', false);
    expect(await watchlist.getStaticWatchlist()).toEqual(['woocommerce', 'elementor']);
  });

  it('returns an empty array when unset', async () => {
    await appSetting.set('wporg.watchlist_static', '', 'string', null, 'sync', false);
    expect(await watchlist.getStaticWatchlist()).toEqual([]);
  });
});
