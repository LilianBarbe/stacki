const fs = require('fs');
const path = require('path');

const canonical = (dir) => {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
};

// Keep processes in main while the renderer changes projects. Only cold starts
// are serialized, so a warm workspace never waits for another one to compile.
function createDevServerPool({ start, stop, alive, notify = () => {} }) {
  const entries = new Map();
  const stopping = new Map();
  let active = null;
  let startTail = Promise.resolve();
  const isActive = (dir) => active === canonical(dir);
  const get = (dir = active) => dir ? entries.get(canonical(dir))?.server || null : null;

  function createEntry(projectPath) {
    const entry = { projectPath, server: null, ready: false, promise: null, log: '' };
    entry.assertLive = () => {
      if (entries.get(projectPath) !== entry) throw new Error('Preview startup was cancelled.');
    };
    entry.attach = (server) => {
      entry.assertLive();
      entry.server = server;
    };
    entry.pushLog = (chunk) => {
      if (entries.get(projectPath) !== entry) return;
      entry.log = (entry.log + chunk).slice(-64000);
      if (isActive(projectPath)) notify('dev:log', chunk);
    };
    entry.recentLog = (maxChars = 1200) => entry.log.replace(/\x1b\[[0-9;]*m/g, '').slice(-maxChars).trim();
    entry.exited = (server, code) => {
      if (entries.get(projectPath) !== entry || entry.server !== server) return;
      entry.server = null;
      entry.ready = false;
      if (isActive(projectPath)) notify('dev:exit', { code, log: entry.recentLog() });
    };
    entry.stop = async () => {
      const server = entry.server;
      entry.server = null;
      entry.ready = false;
      if (server && !server.external) {
        const task = Promise.resolve().then(() => stop(server));
        stopping.set(projectPath, task);
        try { await task; } finally {
          if (stopping.get(projectPath) === task) stopping.delete(projectPath);
        }
      }
    };
    return entry;
  }

  function open(dir) {
    const projectPath = canonical(dir);
    active = projectPath;
    let entry = entries.get(projectPath);
    if (!entry) {
      entry = createEntry(projectPath);
      entries.set(projectPath, entry);
    }
    if (entry.log) notify('dev:log', entry.log);
    if (entry.promise) return entry.promise;
    entry.promise = (async () => {
      // A second Restart can arrive before the first shutdown completes.
      // In particular, a delayed daemon stop must not kill its replacement.
      if (stopping.has(projectPath)) await stopping.get(projectPath);
      entry.assertLive();
      const cached = entry.server;
      if (cached && entry.ready && await alive(cached.url)) {
        entry.assertLive();
        if (entry.server === cached) return { url: cached.url, external: !!cached.external, bare: !!cached.bare, reused: true };
      }
      entry.assertLive();
      await entry.stop();
      const coldStart = startTail.then(async () => {
        entry.assertLive();
        entry.log = '';
        try {
          const result = await start(entry);
          entry.assertLive();
          if (!entry.server) throw new Error('Dev server exited before it was ready.');
          entry.ready = true;
          return { ...result, reused: false };
        } catch (err) {
          await entry.stop();
          throw err;
        }
      });
      startTail = coldStart.catch(() => {});
      return coldStart;
    })().finally(() => { entry.promise = null; });
    return entry.promise;
  }

  async function stopProject(dir = active) {
    if (!dir) return;
    const key = canonical(dir);
    const entry = entries.get(key);
    entries.delete(key); // invalidates a startup still waiting on dependencies
    if (entry) await entry.stop();
    if (stopping.has(key)) await stopping.get(key);
  }

  async function stopAll() {
    active = null;
    const tasks = [...entries.keys()].map((key) => stopProject(key));
    await Promise.allSettled([...tasks, ...stopping.values()]);
  }

  const info = (dir) => {
    const entry = entries.get(canonical(dir));
    if (!entry?.server && !entry?.promise) return null;
    return { url: entry.server?.url || null, state: entry.ready ? 'running' : 'starting' };
  };

  return { open, get, info, isActive, stop: stopProject, stopAll, detach: () => { active = null; } };
}

module.exports = { createDevServerPool };
