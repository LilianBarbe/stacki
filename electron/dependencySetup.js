const fs = require('fs');
const path = require('path');

function hasAstroBinary(dir) {
  return fs.existsSync(path.join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'astro.cmd' : 'astro'));
}

const canonical = (dir) => {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
};

// Main-process lifetime: preparation survives a renderer reload. A foreground
// open joins the same job, including while npm has created only part of .bin.
function createDependencySetup({ install, ready = hasAstroBinary, notify = () => {} }) {
  const jobs = new Map();
  const failures = new Map();
  let tail = Promise.resolve();

  const status = (dir) => {
    const key = canonical(dir);
    if (jobs.has(key)) return { state: jobs.get(key).state };
    if (failures.has(key)) return { state: 'failed', error: failures.get(key) };
    return { state: ready(key) ? 'ready' : 'missing' };
  };

  const ensure = (dir) => {
    const key = canonical(dir);
    if (jobs.has(key)) return jobs.get(key).promise;
    if (status(key).state === 'ready') return Promise.resolve();
    failures.delete(key);
    const job = { state: 'queued', promise: null };
    jobs.set(key, job);
    notify({ projectPath: key, state: 'queued' });
    job.promise = tail.then(async () => {
      job.state = 'installing';
      notify({ projectPath: key, state: 'installing' });
      try {
        await install(key);
        if (!ready(key)) throw new Error('Astro is still missing after installation. Check the project dependencies and try again.');
      } catch (err) {
        failures.set(key, String(err.message || err));
        throw err;
      } finally {
        jobs.delete(key);
        notify({ projectPath: key, ...status(key) });
      }
    });
    // An unsuccessful workspace must not prevent the next one from preparing.
    tail = job.promise.catch(() => {});
    return job.promise;
  };

  return { ensure, status };
}

module.exports = { createDependencySetup, hasAstroBinary };
