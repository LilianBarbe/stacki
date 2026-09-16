// Exercise main's actual process startup and shutdown with a tiny CLI that
// accepts Astro's port argument. No installed Astro project or Electron UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { createDevServerPool } = require('../electron/devServerPool');

test('main gives each workspace its own port, reuses warm processes and shuts them down', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-servers-'));
  const cli = path.join(temp, 'astro-standin.cjs');
  fs.writeFileSync(cli, `
    const http = require('node:http');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    http.createServer((req, res) => res.end(JSON.stringify({ cwd: process.cwd(), pid: process.pid })))
      .listen(port, '127.0.0.1', () => console.log('Ready: ' + process.cwd()));
  `);
  const a = path.join(temp, 'a');
  const b = path.join(temp, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  const calls = new Map();
  const children = [];
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const context = {
    fs, path, net, process, execFile, setTimeout, clearTimeout, URL,
    isWin: process.platform === 'win32',
    spawn: (...args) => { const child = spawn(...args); children.push(child); return child; },
    resolveNodeBin: () => process.execPath,
    nodeCliCommand: (_bin, args) => [process.execPath, [cli, ...args]],
    writeMarkerConfig: () => path.join(temp, 'marker.mjs'),
    toPosix: (value) => value.split(path.sep).join('/'),
    devServerEnv: (env) => env,
    dependencySetup: { status: () => ({ state: 'ready' }) },
    ipcMain: { handle: (channel, fn) => calls.set(channel, fn) },
    captureEra: 0, scheduleThumb: () => {}, readTrailingSlash: () => 'ignore',
    thumbTimer: null,
  };
  vm.createContext(context);
  vm.runInContext([
    section('function findFreePort(', '// The page formats Astro routes'),
    section('function stopDevServer()', '// Wraps the project'),
    section('async function spawnDevServer(', '// Style sources'),
  ].join('\n'), context);
  context.devServers = createDevServerPool({
    start: context.doDevStart,
    stop: context.stopServerProcess,
    alive: context.serverAlive,
  });
  t.after(async () => {
    await context.stopAllDevServers();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const open = calls.get('dev:start');
  const first = await open(null, a);
  const firstProcess = context.devServers.get(a).proc;
  const firstPage = await (await fetch(first.url)).json();
  context.devServers.detach();
  const second = await open(null, b);
  const secondProcess = context.devServers.get(b).proc;
  assert.notEqual(first.url, second.url);
  assert.equal((await (await fetch(second.url)).json()).cwd, fs.realpathSync(b));
  assert.equal((await (await fetch(first.url)).json()).cwd, fs.realpathSync(a));
  const warm = await open(null, a);
  assert.equal(warm.url, first.url);
  assert.equal(warm.reused, true);
  assert.equal((await (await fetch(warm.url)).json()).pid, firstPage.pid);
  assert.equal(children.length, 2, 'returning to a workspace never spawns a replacement');
  await context.stopDevServer();
  assert.ok(firstProcess.exitCode !== null || firstProcess.signalCode !== null);
  assert.equal((await fetch(second.url)).status, 200, 'restarting the current workspace leaves others alone');
  await context.stopAllDevServers();
  assert.ok(secondProcess.exitCode !== null || secondProcess.signalCode !== null);
});
