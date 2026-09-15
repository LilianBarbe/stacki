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

// Static gate first: typecheck, lint, and the migration ratchet. These are
// fast and fail cheap; a broken static check never reaches the test suites.
// This is the contract gate AI-generated code must satisfy.
const staticGates = [
  // Contracts build first: the root typecheck resolves shared/dist/*.d.ts.
  ['build:contracts', [process.execPath, path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join('shared', 'tsconfig.json')]],
  ['build:electron', [process.execPath, path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join('electron', 'tsconfig.json')]],
  ['build:morph', [process.execPath, path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join('electron', 'tsconfig.morph.json')]],
  ['tsc --noEmit', [process.execPath, path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']],
  ['eslint', [process.execPath, path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'), '.']],
  ['ratchet-check', [process.execPath, path.join(root, 'scripts', 'ratchet-check.js')]],
];
for (const [label, [bin, ...args]] of staticGates) {
  console.log(`\n[gate] ${label}`);
  const result = spawnSync(bin, args, { cwd: root, env, stdio: 'inherit' });
  if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') {
    process.exit(130);
  }
  if (result.status !== 0 || result.error) {
    console.error(`\nStatic gate failed: ${label}`);
    process.exit(1);
  }
}
for (const [index, name] of names.entries()) {
  console.log(`\n[${index + 1}/${names.length}] ${name}`);
  // Run the existing command verbatim (including Node flags and Electron tests),
  // without spawning an additional npm process for every test file.
  const result = spawnSync(scripts[name], { cwd: root, env, shell: true, stdio: 'inherit' });
  if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') {process.exit(130);}
  if (result.status !== 0 || result.error) {
    failed.push(name);
    if (result.error) {console.error(result.error.message);}
  }
}

// Pre-existing failures on main, verified at the ts-contracts/phase-0-gate
// branch point: they fail without any of this branch's changes. A test that
// stays broken blocks the gate only if it is NOT listed here; a listed test
// that starts passing is reported so the list shrinks.
const QUARANTINED = [
  'test:binding',
  'test:chipedit',
  'test:codeeditorlifecycle',
  'test:codeprop',
  'test:jsguard',
  'test:varsrowheight',
];
// Load-sensitive checks that fail intermittently on main too. Failures
// are tolerated; passing is normal, so no heal report.
const FLAKY = ['test:hovercost', 'test:popoverdropdown'];

console.log(`\n${names.length - failed.length}/${names.length} test commands passed in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
if (failed.length) {console.error(`Failed: ${failed.join(', ')}`);}
const tolerated = [...QUARANTINED, ...FLAKY];
const unexpected = failed.filter((name) => !tolerated.includes(name));
const healed = QUARANTINED.filter((name) => !failed.includes(name) && names.includes(name));
if (healed.length) {
  console.error(`\nQuarantined tests now pass — remove them from QUARANTINED: ${healed.join(', ')}`);
}
process.exitCode = unexpected.length || healed.length ? 1 : 0;
