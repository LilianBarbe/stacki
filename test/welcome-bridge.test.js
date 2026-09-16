// Goal: welcome-screen IPC data is parsed before it controls cards or project creation.
// Methodology: exercise valid dialog/recent/thumbnail shapes, reject malformed and
// duplicate records, and verify transport failures remain explicit Result values.
const test = require('node:test');
const assert = require('node:assert/strict');
const welcome = require('./renderer-module')('welcomeBridge.ts');

const recent = {
  thumb: null,
  stale: true,
  canRefresh: true,
  path: '/project',
  name: 'Project',
  openedAt: 123,
};

test('welcome parsers preserve valid recent, thumbnail, and dialog variants', () => {
  assert.deepEqual(welcome.parseRecentProjects([recent]), [recent]);
  assert.deepEqual(
    welcome.parseRefreshThumb({ ok: true, thumb: 'data:image/png,x', stale: false }),
    {
      ok: true,
      thumb: 'data:image/png,x',
      stale: false,
    },
  );
  assert.deepEqual(
    welcome.parseRefreshThumb({ ok: false, error: 'failed', thumb: null, stale: true }),
    {
      ok: false,
      error: 'failed',
      thumb: null,
      stale: true,
    },
  );
  assert.deepEqual(welcome.parseProjectDialog({ canceled: true }), { canceled: true });
  assert.deepEqual(welcome.parseProjectDialog({ canceled: false, error: 'not Astro' }), {
    canceled: false,
    error: 'not Astro',
  });
  assert.deepEqual(welcome.parseProjectDialog({ canceled: false, projectPath: '/project' }), {
    canceled: false,
    projectPath: '/project',
  });
  assert.deepEqual(welcome.parseParentDialog({ canceled: false, parentPath: '/sites' }), {
    canceled: false,
    parentPath: '/sites',
  });
});

test('welcome parsers reject missing, duplicate, invalid, and oversized records', () => {
  for (const value of [
    null,
    [{ ...recent, openedAt: -1 }],
    [{ ...recent, path: 'bad\0path' }],
    [recent, recent],
    Array(100_001).fill(recent),
  ]) {
    assert.throws(() => welcome.parseRecentProjects(value));
  }
  assert.throws(() => welcome.parseRefreshThumb({ ok: false, thumb: null, stale: true }));
  assert.throws(() => welcome.parseProjectDialog({ canceled: false }));
  assert.throws(() => welcome.parseParentDialog({ canceled: false, parentPath: null }));
});

test('welcome operations validate replies and preserve expected transport failures', async () => {
  global.window = {
    avb: {
      listRecents: async () => [recent],
      refreshThumb: async () => ({ ok: true, thumb: null, stale: false }),
      removeRecent: async () => {
        throw new Error('disk unavailable');
      },
    },
  };
  assert.equal((await welcome.listRecentProjects()).ok, true);
  assert.equal((await welcome.refreshRecentThumbnail('/project')).ok, true);
  assert.deepEqual(await welcome.removeRecentProject('/project'), {
    ok: false,
    error: 'disk unavailable',
  });
  delete global.window;
});
