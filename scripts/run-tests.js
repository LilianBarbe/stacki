#!/usr/bin/env node
// Every test:* command belongs to the gate. Keep the individual commands useful
// without maintaining a second, easily outdated list in the npm test script.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scripts } = require('../package.json');

const root = path.join(__dirname, '..');
const requested = process.argv.slice(2).map((name) => name.startsWith('test:') ? name : `test:${name}`);
const names = requested.length ? requested : Object.keys(scripts).filter((name) => name.startsWith('test:'));
if (!names.length || names.some((name) => !scripts[name])) {
  console.error(`Unknown test command: ${names.filter((name) => !scripts[name]).join(', ')}`);
  process.exit(1);
}

const started = Date.now();
const failed = [];
const env = { ...process.env, PATH: `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH || ''}` };
for (const [index, name] of names.entries()) {
  console.log(`\n[${index + 1}/${names.length}] ${name}`);
  // Run the existing command verbatim (including Node flags and Electron tests),
  // without spawning an additional npm process for every test file.
  const result = spawnSync(scripts[name], { cwd: root, env, shell: true, stdio: 'inherit' });
  if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') process.exit(130);
  if (result.status !== 0 || result.error) {
    failed.push(name);
    if (result.error) console.error(result.error.message);
  }
}

console.log(`\n${names.length - failed.length}/${names.length} test commands passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
if (failed.length) console.error(`Failed: ${failed.join(', ')}`);
process.exitCode = failed.length ? 1 : 0;
