const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createDevServerPool } = require('../electron/devServerPool');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { resolve, promise };
};

test('real workspace servers keep distinct addresses and processes across switches', async (t) => {
  const processes = [];
  const contexts = new Map();
  const events = [];
  const stop = async ({ proc }) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = once(proc, 'exit');
    proc.kill();
    await exited;
  };
  const pool = createDevServerPool({
    start: async (context) => {
      contexts.set(context.projectPath, context);
      const proc = spawn(process.execPath, ['-e', `
        const http = require('node:http');
        const server = http.createServer((req, res) => res.end(JSON.stringify({pid: process.pid, workspace: process.argv[1]})));
        server.listen(0, '127.0.0.1', () => process.send({url: 'http://127.0.0.1:' + server.address().port}));
      `, context.projectPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      processes.push(proc);
      const server = { proc, projectPath: context.projectPath };
      context.attach(server);
      proc.on('exit', (code) => context.exited(server, code));
      const [message] = await once(proc, 'message');
      server.url = message.url;
      context.pushLog(`started ${context.projectPath}\n`);
      return { url: server.url };
    },
    stop,
    alive: async (url) => { try { return (await fetch(url)).ok; } catch { return false; } },
    notify: (channel, data) => events.push({ channel, data }),
  });
  t.after(async () => {
    await pool.stopAll();
    await Promise.all(processes.map((proc) => stop({ proc })));
  });
  const a = path.resolve('workspace-a');
  const b = path.resolve('workspace-b');
  const first = pool.open(a);
  assert.equal(pool.open(a), first, 'duplicate opens join one startup');
  const firstResult = await first;
  const firstPage = await (await fetch(firstResult.url)).json();
  pool.detach();
  const secondResult = await pool.open(b);
  const secondPage = await (await fetch(secondResult.url)).json();
  assert.notEqual(firstResult.url, secondResult.url);
  assert.notEqual(firstPage.pid, secondPage.pid);
  assert.equal(firstPage.workspace, a);
  assert.equal(secondPage.workspace, b);
  assert.equal((await fetch(firstResult.url)).status, 200, 'previous server keeps serving');

  events.length = 0;
  contexts.get(a).pushLog('background A\n');
  assert.deepEqual(events, [], 'background logs do not reach the active renderer');
  const again = await pool.open(a);
  assert.equal(again.reused, true);
  assert.equal(again.url, firstResult.url);
  assert.equal((await (await fetch(again.url)).json()).pid, firstPage.pid);
  assert.equal(processes.length, 2);
  assert.ok(events.some((e) => e.data.includes('background A')), 'the returning workspace gets its log');

  events.length = 0;
  const crashed = pool.get(b);
  await stop(crashed);
  assert.deepEqual(events, [], 'a background crash does not take the visible preview offline');
  assert.equal(pool.get(b), null);
  const restarted = await pool.open(b);
  assert.equal(restarted.reused, false);
  assert.equal(processes.length, 3);
  assert.equal(pool.get(a).url, firstResult.url);
  await pool.stop();
  assert.equal(pool.get(b), null, 'stop affects only the selected workspace');
  assert.equal((await fetch(firstResult.url)).status, 200);
  await pool.stopAll();
  assert.equal(pool.get(a), null);
  assert.ok(processes.every((p) => p.exitCode !== null || p.signalCode !== null));
});

test('cold starts are serial, warm reuse is immediate, and cancelled starts cannot return', async () => {
  const gate = deferred();
  const started = [];
  const stopped = [];
  const a = path.resolve('warm');
  const b = path.resolve('slow');
  const c = path.resolve('queued');
  const pool = createDevServerPool({
    start: async (context) => {
      started.push(context.projectPath);
      if (context.projectPath === b) await gate.promise;
      context.assertLive();
      const server = { url: `http://localhost:${4320 + started.length}`, projectPath: context.projectPath };
      context.attach(server);
      return { url: server.url };
    },
    stop: async (server) => stopped.push(server.projectPath),
    alive: async () => true,
  });
  await pool.open(a);
  const pending = pool.open(b);
  const queued = pool.open(c);
  const rejected = assert.rejects(pending, /cancelled/);
  const rejectedQueued = assert.rejects(queued, /cancelled/);
  await tick();
  assert.deepEqual(started, [a, b]);
  const warm = await pool.open(a);
  assert.equal(warm.reused, true, 'a warm workspace does not wait for the cold-start queue');
  await pool.stopAll();
  gate.resolve();
  await Promise.all([rejected, rejectedQueued]);
  assert.deepEqual(stopped, [a]);
  assert.deepEqual(started, [a, b], 'the cancelled queued workspace never starts');
  assert.equal(pool.get(b), null);
});

test('dead cached servers restart, flags survive reuse, and external servers are never stopped', async () => {
  let running = true;
  let starts = 0;
  let stops = 0;
  const pool = createDevServerPool({
    start: async (context) => {
      starts++;
      const server = { url: `http://localhost:${4320 + starts}`, external: starts === 1, bare: true };
      context.attach(server);
      return server;
    },
    stop: async () => { stops++; },
    alive: async () => running,
  });
  await pool.open('/external');
  const warm = await pool.open('/external');
  assert.equal(warm.external, true);
  assert.equal(warm.bare, true);
  running = false;
  const restarted = await pool.open('/external');
  assert.equal(restarted.reused, false);
  assert.equal(stops, 0, 'dead external processes are not killed');
  await pool.stopAll();
  assert.equal(stops, 1, 'owned replacement is stopped');
});

test('startup failure cleans its process and repeated shutdown waits for pending stops', async () => {
  const gate = deferred();
  let fail = true;
  const stopped = [];
  const pool = createDevServerPool({
    start: async (context) => {
      context.attach({ url: 'http://localhost:4321', projectPath: context.projectPath });
      if (fail) throw new Error('startup timed out');
      return { url: context.server.url };
    },
    stop: async (server) => {
      stopped.push(server.projectPath);
      if (!fail) await gate.promise;
    },
    alive: async () => true,
  });
  await assert.rejects(pool.open('/failed'), /startup timed out/);
  assert.equal(pool.get('/failed'), null);
  assert.equal(stopped.length, 1);
  fail = false;
  await pool.open('/failed');
  const one = pool.stopAll();
  let done = false;
  const two = pool.stopAll().then(() => { done = true; });
  await tick();
  assert.equal(done, false, 'quitting cannot overtake a stop initiated by window close');
  gate.resolve();
  await Promise.all([one, two]);
  assert.equal(stopped.length, 2);
});

test('a replacement waits until its previous server has fully stopped', async () => {
  const gate = deferred();
  let starts = 0;
  const pool = createDevServerPool({
    start: async (context) => {
      starts++;
      context.attach({ url: `http://localhost:${4320 + starts}` });
      return { url: context.server.url };
    },
    stop: async () => gate.promise,
    alive: async () => true,
  });
  await pool.open('/restart');
  const stopping = pool.stop('/restart');
  const opening = pool.open('/restart');
  await tick();
  assert.equal(starts, 1, 'the replacement cannot race an old daemon stop');
  gate.resolve();
  await stopping;
  await opening;
  assert.equal(starts, 2);
  await pool.stopAll();
});
