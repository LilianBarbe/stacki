// Exercise main's actual process startup and shutdown with a tiny CLI that
// accepts Astro's port argument. No installed Astro project or Electron UI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const net = require('node:net');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { createDevServerPool } = require('../electron/devServerPool');

test('main gives each workspace its own port, reuses warm processes and shuts them down', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-servers-'));
  const cli = path.join(temp, 'astro-standin.cjs');
  fs.writeFileSync(cli, `
    const http = require('node:http');
    const fs = require('node:fs');
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    if (fs.existsSync('.fail-first')) {
      fs.unlinkSync('.fail-first');
      console.error('Another astro dev server is already running. URL: ' + fs.readFileSync('.external-url', 'utf8'));
      process.exit(1);
    }
    if (fs.existsSync('.astro/dev.json') && !process.argv.includes('--ignore-lock')) {
      console.error('Another astro dev server is already running.');
      process.exit(1);
    }
    if (process.argv.includes('--ignore-lock') && process.argv.includes('--force')) process.exit(1);
    http.createServer((req, res) => res.end(JSON.stringify({ cwd: process.cwd(), pid: process.pid, args: process.argv.slice(2) })))
      .listen(port, '127.0.0.1', () => console.log('Ready: ' + process.cwd()));
  `);
  const a = path.join(temp, 'a');
  const b = path.join(temp, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  for (const dir of [a, b]) {
    fs.mkdirSync(path.join(dir, 'node_modules/astro'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/astro/package.json'), JSON.stringify({ version: '7.2.9' }));
  }
  const external = http.createServer((_req, res) => res.end('ordinary Astro preview'));
  await new Promise((resolve) => external.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => external.close(resolve)));
  const externalUrl = `http://127.0.0.1:${external.address().port}`;
  fs.mkdirSync(path.join(a, '.astro'));
  const lock = JSON.stringify({ url: externalUrl, pid: process.pid });
  fs.writeFileSync(path.join(a, '.astro/dev.json'), lock);
  // Also cover discovering an existing server from CLI output during a retry.
  fs.writeFileSync(path.join(b, '.fail-first'), '');
  fs.writeFileSync(path.join(b, '.external-url'), externalUrl);
  const calls = new Map();
  const children = [];
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
  const context = {
    fs, path, net, process, execFile, setTimeout, clearTimeout, URL,
    commandNeedsShell: require('../electron/platform').commandNeedsShell,
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
    section('function supportsIndependentDevServer(', '// Style sources'),
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
  assert.notEqual(first.url, externalUrl, 'the ordinary server is never used as the canvas');
  assert.ok(firstPage.args.includes('--config'), 'the editor keeps its marker config');
  assert.ok(firstPage.args.includes('--ignore-lock'));
  assert.ok(!firstPage.args.includes('--force'), 'the other server must not be replaced');
  context.devServers.detach();
  const second = await open(null, b);
  const secondProcess = context.devServers.get(b).proc;
  assert.notEqual(second.url, externalUrl, 'a retry must not adopt the server named in the error');
  const secondPage = await (await fetch(second.url)).json();
  assert.ok(secondPage.args.includes('--ignore-lock'));
  assert.ok(!secondPage.args.includes('--force'), 'retrying must also leave the other server alone');
  assert.notEqual(first.url, second.url);
  assert.equal((await (await fetch(second.url)).json()).cwd, fs.realpathSync(b));
  assert.equal((await (await fetch(first.url)).json()).cwd, fs.realpathSync(a));
  const warm = await open(null, a);
  assert.equal(warm.url, first.url);
  assert.equal(warm.reused, true);
  assert.equal((await (await fetch(warm.url)).json()).pid, firstPage.pid);
  assert.equal(children.length, 3, 'two workspaces plus one retry; returning never spawns a replacement');
  await context.stopDevServer();
  assert.ok(firstProcess.exitCode !== null || firstProcess.signalCode !== null);
  assert.equal((await fetch(second.url)).status, 200, 'restarting the current workspace leaves others alone');
  await context.stopAllDevServers();
  assert.ok(secondProcess.exitCode !== null || secondProcess.signalCode !== null);
  assert.equal(await (await fetch(externalUrl)).text(), 'ordinary Astro preview', 'closing Stacki leaves the ordinary server running');
  assert.equal(fs.readFileSync(path.join(a, '.astro/dev.json'), 'utf8'), lock);

  for (const [version, supported] of [
    ['5.16.0', false], ['6.0.0', false], ['7.0.9', false],
    ['7.1.0', true], ['7.2.9', true], ['8.0.0', true], ['unknown', false],
  ]) {
    fs.writeFileSync(path.join(a, 'node_modules/astro/package.json'), JSON.stringify({ version }));
    assert.equal(context.supportsIndependentDevServer(a), supported, version);
  }
});
