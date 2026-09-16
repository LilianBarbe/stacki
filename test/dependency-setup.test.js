const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDependencySetup, hasAstroBinary } = require('../electron/dependencySetup');

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('preparation is serial and a foreground open joins the same installation', async () => {
  const installed = new Set();
  const started = [];
  const finishes = [];
  const events = [];
  const setup = createDependencySetup({
    ready: (dir) => installed.has(dir),
    notify: (event) => events.push(event),
    install: (dir) => new Promise((resolve) => {
      started.push(dir);
      finishes.push(() => { installed.add(dir); resolve(); });
    }),
  });
  const a = path.resolve('workspace-a');
  const b = path.resolve('workspace-b');
  const first = setup.ensure(a);
  const second = setup.ensure(b);
  assert.equal(setup.status(a).state, 'queued');
  assert.equal(setup.status(b).state, 'queued');
  await tick();
  assert.deepEqual(started, [a]);
  assert.equal(setup.status(a).state, 'installing');
  // npm may expose the binary before its lifecycle scripts have finished.
  installed.add(a);
  assert.equal(setup.status(a).state, 'installing');
  assert.equal(setup.ensure(a), first, 'opening cannot bypass or duplicate preparation');
  finishes.shift()();
  await first;
  await tick();
  assert.equal(setup.status(a).state, 'ready');
  assert.deepEqual(started, [a, b]);
  finishes.shift()();
  await second;
  await setup.ensure(a);
  assert.equal(started.length, 2, 'a prepared workspace needs no new install');
  assert.deepEqual(events.filter((e) => e.projectPath === a).map((e) => e.state), ['queued', 'installing', 'ready']);
});

test('a failed install stays failed even with a partial binary, is retryable and releases the queue', async () => {
  const available = new Set();
  const bad = path.resolve('failed-workspace');
  const good = path.resolve('good-workspace');
  let shouldFail = true;
  const setup = createDependencySetup({
    ready: (dir) => available.has(dir),
    install: async (dir) => {
      available.add(dir);
      if (dir === bad && shouldFail) throw new Error('postinstall failed');
    },
  });
  const failed = setup.ensure(bad);
  const following = setup.ensure(good);
  await assert.rejects(failed, /postinstall failed/);
  await following;
  assert.deepEqual(setup.status(bad), { state: 'failed', error: 'postinstall failed' });
  assert.equal(setup.status(good).state, 'ready');
  shouldFail = false;
  await setup.ensure(bad);
  assert.equal(setup.status(bad).state, 'ready');
});

test('an empty node_modules folder is not a prepared Astro project', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
  assert.equal(hasAstroBinary(dir), false);
  const setup = createDependencySetup({ install: async () => {} });
  await assert.rejects(setup.ensure(dir), /Astro is still missing/);
  const bin = process.platform === 'win32' ? 'astro.cmd' : 'astro';
  fs.writeFileSync(path.join(dir, 'node_modules', '.bin', bin), '');
  assert.equal(hasAstroBinary(dir), true);
  await setup.ensure(dir);
  assert.equal(setup.status(dir).state, 'ready');
});
