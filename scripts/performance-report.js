#!/usr/bin/env node
// Compare the preview diff against a local checkpoint without changing checkout.
// Usage: node scripts/performance-report.js d9f9c05
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const file = 'electron/morphClient.js';
function load(source) {
  let allocated = 0;
  const start = source.indexOf('function diffChildren(');
  const end = source.indexOf('// Raised when the live document', start);
  if (start < 0 || end < 0) throw new Error('Cannot locate the preview diff in this revision.');
  const diff = new Function('Int32Array', `${source.slice(start, end)}\nreturn diffChildren;`)(function TrackedArray(size) {
    allocated += size * Int32Array.BYTES_PER_ELEMENT;
    return new Int32Array(size);
  });
  return { diff, allocation: () => allocated, reset: () => { allocated = 0; } };
}

const current = load(fs.readFileSync(path.join(root, file), 'utf8'));
const ref = process.argv[2];
const before = ref ? load(execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })) : null;
const keys = Array.from({ length: 2000 }, (_, i) => `node:${i}`);
const cases = [
  ['Unchanged siblings', keys, keys],
  ['Append one sibling', keys, [...keys, 'new']],
  ['Remove last sibling', keys, keys.slice(0, -1)],
  ['Swap first two siblings', keys.slice(0, 200), [keys[1], keys[0], ...keys.slice(2, 200)]],
];
function measure(implementation, a, b) {
  implementation.diff(a, b);
  implementation.reset();
  const runs = 5;
  const start = performance.now();
  for (let i = 0; i < runs; i++) implementation.diff(a, b);
  return { ms: ((performance.now() - start) / runs).toFixed(3), matrixBytes: implementation.allocation() / runs };
}

console.log('Preview sibling diff; mean of 5 warm runs. Matrix bytes exclude input/output arrays.');
for (const [label, a, b] of cases) {
  if (before) assert.deepEqual(current.diff(a, b), before.diff(a, b), `${label} preserves exact edit operations`);
  console.log(JSON.stringify({ case: label, siblings: a.length, ...(before ? { before: measure(before, a, b) } : {}), after: measure(current, a, b) }));
}
