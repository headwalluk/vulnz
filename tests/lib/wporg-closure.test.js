/**
 * wordpress.org closure tracking (M17.7)
 *
 * wordpress.org answers HTTP 404 both for a slug it has never heard of and
 * for a plugin it has withdrawn, and only the response body separates them.
 * The sync used to branch on the status code alone, so a withdrawn plugin —
 * frequently withdrawn *because* of an unpatched vulnerability — was recorded
 * identically to a premium plugin that was never listed.
 *
 * These tests pin the distinction, the reason vocabulary, and the rule that
 * curated metadata is never overwritten by a closure record.
 */

const { createTestDatabase, initializeSchema, cleanupTestDatabase } = require('../setup');

const mockDb = {
  query: jest.fn(),
  getConnection: jest.fn(),
};

jest.mock('../../src/db', () => mockDb);

const wporg = require('../../src/lib/wporg');

const CONFIG = { baseUrl: 'https://api.wordpress.org', endpoint: '/plugins/info/1.0/', timeout: 5000, userAgent: 'VULNZ/test', highPriorityDelayMs: 0 };

/** The shape wordpress.org returns for a withdrawn plugin. */
const closedBody = ({ reason = 'security-issue', closedDate = '2017-11-20', name = 'Portable phpMyAdmin' } = {}) => ({
  error: 'closed',
  closed: true,
  closed_date: closedDate,
  reason,
  reason_text: reason,
  name,
  description: `This plugin has been closed as of ${closedDate} and is not available for download.`,
});

const NOT_FOUND_BODY = { error: 'Plugin not found.' };

describe('wordpress.org closure tracking', () => {
  let db;

  async function addComponent(slug, { title, priority = 'low' } = {}) {
    const result = await db.query('INSERT INTO components (slug, component_type_slug, title, sync_priority_slug) VALUES (?, ?, ?, ?)', [
      slug,
      'wordpress-plugin',
      title || slug,
      priority,
    ]);
    return result.insertId;
  }

  async function getComponent(id) {
    const rows = await db.query('SELECT * FROM components WHERE id = ?', [id]);
    return rows[0];
  }

  const respondWith = (status, body) => async () => ({ status, json: async () => body });

  beforeAll(async () => {
    db = await createTestDatabase();
    mockDb.query.mockImplementation((...args) => db.query(...args));
    await initializeSchema(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  describe('syncPluginComponent on 404', () => {
    it('records a withdrawn plugin as closed, with reason and date', async () => {
      const id = await addComponent('portable-phpmyadmin');
      const component = await getComponent(id);

      const result = await wporg.syncPluginComponent(component, respondWith(404, closedBody()), CONFIG);

      expect(result.wporgStatus).toBe('closed');
      expect(result.closureReason).toBe('security-issue');
      expect(result.closedAt).toBe('2017-11-20');

      const stored = await getComponent(id);
      expect(stored.wporg_status_slug).toBe('closed');
      expect(stored.wporg_closure_reason_slug).toBe('security-issue');
      expect(stored.wporg_closed_at).toBe('2017-11-20');
    });

    it('records a slug the directory has never listed as absent', async () => {
      const id = await addComponent('some-premium-plugin');
      const component = await getComponent(id);

      const result = await wporg.syncPluginComponent(component, respondWith(404, NOT_FOUND_BODY), CONFIG);

      expect(result.wporgStatus).toBe('absent');

      const stored = await getComponent(id);
      expect(stored.wporg_status_slug).toBe('absent');
      expect(stored.wporg_closure_reason_slug).toBeNull();
      expect(stored.wporg_closed_at).toBeNull();
    });

    it('keeps wporg_available at 0 for both, so the watchlist probe still works', async () => {
      const closedId = await addComponent('closed-for-watchlist');
      const absentId = await addComponent('absent-for-watchlist');

      await wporg.syncPluginComponent(await getComponent(closedId), respondWith(404, closedBody()), CONFIG);
      await wporg.syncPluginComponent(await getComponent(absentId), respondWith(404, NOT_FOUND_BODY), CONFIG);

      expect((await getComponent(closedId)).wporg_available).toBe(0);
      expect((await getComponent(absentId)).wporg_available).toBe(0);
    });

    it('adopts the real plugin name when the component is still titled with its slug', async () => {
      const id = await addComponent('portable-phpmyadmin-2');
      const component = await getComponent(id);

      await wporg.syncPluginComponent(component, respondWith(404, closedBody({ name: 'Portable phpMyAdmin' })), CONFIG);

      expect((await getComponent(id)).title).toBe('Portable phpMyAdmin');
    });

    it('never overwrites a curated title with the closure record', async () => {
      const id = await addComponent('curated-plugin', { title: 'Our Own Name For It' });
      const component = await getComponent(id);

      await wporg.syncPluginComponent(component, respondWith(404, closedBody({ name: 'Something Else Entirely' })), CONFIG);

      expect((await getComponent(id)).title).toBe('Our Own Name For It');
    });

    it('never writes the closure notice into description', async () => {
      const id = await addComponent('closure-notice-plugin');
      await db.query('UPDATE components SET description = ? WHERE id = ?', ['A description someone wrote by hand.', id]);
      const component = await getComponent(id);

      await wporg.syncPluginComponent(component, respondWith(404, closedBody()), CONFIG);

      // The closed body's `description` is the directory's closure notice,
      // not a description of the plugin. Writing it would replace curated
      // copy with boilerplate on exactly the components most likely to have
      // been curated.
      expect((await getComponent(id)).description).toBe('A description someone wrote by hand.');
    });

    it('falls back to the unknown reason when the body carries none', async () => {
      const id = await addComponent('closed-no-reason');
      const component = await getComponent(id);

      await wporg.syncPluginComponent(component, respondWith(404, { error: 'closed', closed: true }), CONFIG);

      const stored = await getComponent(id);
      expect(stored.wporg_status_slug).toBe('closed');
      expect(stored.wporg_closure_reason_slug).toBe('unknown');
      expect(stored.wporg_closed_at).toBeNull();
    });

    it('records an unrecognised reason verbatim rather than losing it', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const id = await addComponent('closed-new-reason');
      const component = await getComponent(id);

      await wporg.syncPluginComponent(component, respondWith(404, closedBody({ reason: 'newly-invented-reason' })), CONFIG);

      const stored = await getComponent(id);
      expect(stored.wporg_closure_reason_slug).toBe('newly-invented-reason');

      // Unclassified, not "not a security concern" — nobody has looked at it.
      const [reason] = await db.query('SELECT * FROM wporg_closure_reasons WHERE slug = ?', ['newly-invented-reason']);
      expect(reason.is_security_concern).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('treats a 404 whose body will not parse as absent rather than failing the batch', async () => {
      const id = await addComponent('unparseable-body');
      const component = await getComponent(id);

      const fetchImpl = async () => ({
        status: 404,
        json: async () => {
          throw new Error('not json');
        },
      });

      const result = await wporg.syncPluginComponent(component, fetchImpl, CONFIG);

      expect(result.wporgStatus).toBe('absent');
      expect((await getComponent(id)).wporg_status_slug).toBe('absent');
    });
  });

  describe('syncPluginComponent on 200', () => {
    it('records an available plugin and clears any earlier closure', async () => {
      const id = await addComponent('reopened-plugin');

      await wporg.syncPluginComponent(await getComponent(id), respondWith(404, closedBody()), CONFIG);
      expect((await getComponent(id)).wporg_status_slug).toBe('closed');

      // A plugin can be restored to the directory. The closure columns must
      // not persist once it is available again, or it reads as closed forever.
      await wporg.syncPluginComponent(await getComponent(id), respondWith(200, { name: 'Reopened Plugin', version: '1.0.0' }), CONFIG);

      const stored = await getComponent(id);
      expect(stored.wporg_status_slug).toBe('available');
      expect(stored.wporg_closure_reason_slug).toBeNull();
      expect(stored.wporg_closed_at).toBeNull();
      expect(stored.wporg_available).toBe(1);
    });
  });

  describe('transient failures', () => {
    it('leaves the recorded status untouched on a 5xx', async () => {
      const id = await addComponent('flaky-plugin');
      await wporg.syncPluginComponent(await getComponent(id), respondWith(404, closedBody()), CONFIG);

      const result = await wporg.syncPluginComponent(await getComponent(id), respondWith(503, {}), CONFIG);

      expect(result.wporgStatus).toBe('unknown');
      // Still closed — a rate limit is not evidence the plugin came back.
      expect((await getComponent(id)).wporg_status_slug).toBe('closed');
    });
  });

  describe('reclassifyUnknown', () => {
    it('resolves only the components still marked unknown, and reports security closures', async () => {
      await db.query('DELETE FROM components');

      await addComponent('was-closed-for-security');
      await addComponent('was-never-listed');
      const settledId = await addComponent('already-resolved');
      await db.query("UPDATE components SET wporg_status_slug = 'available' WHERE id = ?", [settledId]);

      const requested = [];
      const fetchImpl = async (url) => {
        requested.push(url);
        if (url.includes('was-closed-for-security')) {
          return { status: 404, json: async () => closedBody({ reason: 'security-issue', closedDate: '2024-01-05' }) };
        }
        return { status: 404, json: async () => NOT_FOUND_BODY };
      };

      const summary = await wporg.reclassifyUnknown({ fetchImpl });

      expect(summary.checked).toBe(2);
      expect(summary.closed).toBe(1);
      expect(summary.absent).toBe(1);
      expect(requested.some((url) => url.includes('already-resolved'))).toBe(false);

      expect(summary.securityClosures).toEqual([{ slug: 'was-closed-for-security', reason: 'security-issue', closedAt: '2024-01-05' }]);
    });

    it('does not report a non-security closure as a security closure', async () => {
      await db.query('DELETE FROM components');
      await addComponent('closed-by-author');

      const summary = await wporg.reclassifyUnknown({
        fetchImpl: async () => ({ status: 404, json: async () => closedBody({ reason: 'author-request' }) }),
      });

      expect(summary.closed).toBe(1);
      expect(summary.securityClosures).toEqual([]);
    });

    it('honours the limit so a long backlog can be worked through in runs', async () => {
      await db.query('DELETE FROM components');
      await addComponent('unknown-one');
      await addComponent('unknown-two');
      await addComponent('unknown-three');

      const summary = await wporg.reclassifyUnknown({
        limit: 2,
        fetchImpl: async () => ({ status: 404, json: async () => NOT_FOUND_BODY }),
      });

      expect(summary.checked).toBe(2);
    });
  });
});
