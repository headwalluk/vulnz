/**
 * wordpress.org sync lane tests (M12)
 *
 * Covers version capture + release upsert + availability recording in the
 * shared per-plugin sync, and the high/low lane selection rules.
 */

const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const wporg = require('../../src/lib/wporg');

let db;

async function addComponent(slug, priority) {
  const result = await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug) VALUES (?, ?, ?, ?)', [
    slug,
    'wordpress-plugin',
    slug,
    priority || 'low',
  ]);
  return result.insertId;
}

async function getComponent(id) {
  const rows = await db.query('SELECT * FROM components WHERE id = ?', [id]);
  return rows[0];
}

async function releaseVersions(componentId) {
  const rows = await db.query('SELECT version FROM releases WHERE component_id = ? ORDER BY version', [componentId]);
  return rows.map((row) => row.version);
}

describe('wporg.syncPluginComponent', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  const config = { baseUrl: 'https://api.wordpress.org', endpoint: '/plugins/info/1.0/', timeout: 5000, userAgent: 'VULNZ/test' };

  it('captures the version, upserts a release, and marks availability on 200', async () => {
    const id = await addComponent('good-plugin');
    const fetchImpl = async () => ({
      status: 200,
      json: async () => ({ name: 'Good Plugin', version: '3.4.5', last_updated: '2026-01-02 3:00pm GMT' }),
    });

    const result = await wporg.syncPluginComponent({ id, slug: 'good-plugin' }, fetchImpl, config);
    expect(result).toMatchObject({ status: 200, available: true, version: '3.4.5' });

    const component = await getComponent(id);
    expect(component.latest_version).toBe('3.4.5');
    expect(component.wporg_available).toBe(1);
    expect(component.synced_from_wporg).toBe(1);
    expect(await releaseVersions(id)).toEqual(['3.4.5']);
  });

  it('does not duplicate a release when the same version is seen again', async () => {
    const id = await addComponent('repeat-plugin');
    const fetchImpl = async () => ({ status: 200, json: async () => ({ name: 'Repeat', version: '1.0.0' }) });

    await wporg.syncPluginComponent({ id, slug: 'repeat-plugin' }, fetchImpl, config);
    await wporg.syncPluginComponent({ id, slug: 'repeat-plugin' }, fetchImpl, config);

    expect(await releaseVersions(id)).toEqual(['1.0.0']);
  });

  it('records unavailability on 404 without writing a version', async () => {
    const id = await addComponent('gone-plugin');
    const fetchImpl = async () => ({ status: 404, json: async () => ({}) });

    const result = await wporg.syncPluginComponent({ id, slug: 'gone-plugin' }, fetchImpl, config);
    expect(result).toMatchObject({ status: 404, available: false });

    const component = await getComponent(id);
    expect(component.wporg_available).toBe(0);
    expect(component.synced_from_wporg).toBe(1);
    expect(component.latest_version).toBeNull();
  });

  it('leaves state untouched on a transient non-200/404 status', async () => {
    const id = await addComponent('flaky-plugin');
    const fetchImpl = async () => ({ status: 503, json: async () => ({}) });

    const result = await wporg.syncPluginComponent({ id, slug: 'flaky-plugin' }, fetchImpl, config);
    expect(result).toMatchObject({ status: 503, available: null });

    const component = await getComponent(id);
    expect(component.wporg_available).toBeNull();
    expect(component.synced_from_wporg).toBe(0);
  });
});

describe('wporg sync lanes', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
    process.env.WPORG_HIGH_PRIORITY_DELAY_MS = '0';

    await addComponent('high-one', 'high');
    await addComponent('high-two', 'high');
    await addComponent('low-one', 'low');
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
    delete process.env.WPORG_HIGH_PRIORITY_DELAY_MS;
  });

  it('high lane syncs only high-priority components', async () => {
    const synced = [];
    const fetchImpl = async (url) => {
      synced.push(url);
      return { status: 200, json: async () => ({ name: 'x', version: '2.0.0' }) };
    };

    const summary = await wporg.syncHighPriorityPlugins({ fetchImpl });
    expect(summary.synced).toBe(2);
    expect(synced.some((url) => url.includes('high-one'))).toBe(true);
    expect(synced.some((url) => url.includes('high-two'))).toBe(true);
    expect(synced.some((url) => url.includes('low-one'))).toBe(false);
  });

  it('low lane excludes high-priority components', async () => {
    process.env.WPORG_UPDATE_BATCH_SIZE = '10';
    const synced = [];
    const fetchImpl = async (url) => {
      synced.push(url);
      return { status: 200, json: async () => ({ name: 'x', version: '2.0.0' }) };
    };

    await wporg.syncNextPlugin({ fetchImpl });
    expect(synced.some((url) => url.includes('low-one'))).toBe(true);
    expect(synced.some((url) => url.includes('high-one'))).toBe(false);
    delete process.env.WPORG_UPDATE_BATCH_SIZE;
  });
});

// ─── probeWpOrgSlug (M14) ─────────────────────────────────────────────────────

describe('wporg.probeWpOrgSlug', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(() => {
    mockDb.query.mockClear();
  });

  it('reports a published plugin as available, with its name', async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ name: 'Contact Form 7', version: '6.1.6' }) });

    const result = await wporg.probeWpOrgSlug('contact-form-7', { fetchImpl });

    expect(result).toEqual({ status: 200, available: true, wporgStatus: 'available', name: 'Contact Form 7', closureReason: null, closedAt: null });
  });

  it('reports a 404 slug as absent', async () => {
    const fetchImpl = async () => ({ status: 404, json: async () => ({ error: 'Plugin not found.' }) });

    const result = await wporg.probeWpOrgSlug('easypost', { fetchImpl });

    expect(result).toEqual({ status: 404, available: false, wporgStatus: 'absent', name: null, closureReason: null, closedAt: null });
  });

  it('reports a withdrawn plugin as closed, with the reason and date', async () => {
    const fetchImpl = async () => ({
      status: 404,
      json: async () => ({
        error: 'closed',
        closed: true,
        closed_date: '2017-11-20',
        reason: 'security-issue',
        reason_text: 'Security Issue',
        name: 'Portable phpMyAdmin',
      }),
    });

    const result = await wporg.probeWpOrgSlug('portable-phpmyadmin', { fetchImpl });

    // available stays false — it is not published, so flagging it is not the
    // fleet-wide false positive the malware guard exists to prevent.
    expect(result).toEqual({
      status: 404,
      available: false,
      wporgStatus: 'closed',
      name: 'Portable phpMyAdmin',
      closureReason: 'security-issue',
      closedAt: '2017-11-20',
    });
  });

  it('treats a 404 with an unreadable body as absent rather than throwing', async () => {
    const fetchImpl = async () => ({
      status: 404,
      json: async () => {
        throw new Error('invalid json');
      },
    });

    const result = await wporg.probeWpOrgSlug('easypost', { fetchImpl });

    expect(result.wporgStatus).toBe('absent');
  });

  it('treats a 200 carrying an error body as absent, so a real flag is not blocked', async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ error: 'Plugin not found.' }) });

    const result = await wporg.probeWpOrgSlug('easypost', { fetchImpl });

    expect(result).toEqual({ status: 200, available: false, wporgStatus: 'absent', name: null, closureReason: null, closedAt: null });
  });

  it('reports availability as unknown on a transient error', async () => {
    const fetchImpl = async () => ({ status: 503 });

    const result = await wporg.probeWpOrgSlug('easypost', { fetchImpl });

    expect(result).toEqual({ status: 503, available: null, wporgStatus: 'unknown', name: null, closureReason: null, closedAt: null });
  });

  it('does not write to the database', async () => {
    const fetchImpl = async () => ({ status: 200, json: async () => ({ name: 'Contact Form 7' }) });

    await wporg.probeWpOrgSlug('contact-form-7', { fetchImpl });

    // A squatted slug must not have the genuine plugin's metadata written
    // over its component row, so the probe touches nothing.
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it('requests the plugin-info endpoint for the slug', async () => {
    let requestedUrl = null;
    const fetchImpl = async (url) => {
      requestedUrl = url;
      return { status: 404 };
    };

    await wporg.probeWpOrgSlug('easypost', { fetchImpl });

    expect(requestedUrl).toBe('https://api.wordpress.org/plugins/info/1.0/easypost.json');
  });
});
