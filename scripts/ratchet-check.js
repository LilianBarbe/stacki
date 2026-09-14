#!/usr/bin/env node
// Ratchet gate for the strict-tsconfig migration (docs/ts-migration-plan.md).
//
// Legacy files that predate the strict tsconfig carry a @ts-nocheck header.
// The baseline only shrinks: converting a file removes its header, which the
// gate never counts as a regression — but adding a header, or adding new code
// under one, raises the count and fails the gate.
const fs = require('node:fs');
const path = require('node:path');

// Baseline as of the Phase 0 gate commit. Lower it when a conversion lands.
const BASELINE = 44;
const ROOTS = ['src', 'electron', 'scripts', 'test', 'shared'];

const root = path.join(__dirname, '..');
const headers = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {continue;}
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {walk(full);}
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      // The scan skips itself: its own comments contain the directive literal.
      if (path.relative(root, full) === path.join('scripts', 'ratchet-check.js')) {continue;}
      const head = fs.readFileSync(full, 'utf8').slice(0, 4096);
      if (head.includes('@ts-nocheck')) {headers.push(path.relative(root, full));}
    }
  }
};
for (const dir of ROOTS) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) {walk(full);}
}

headers.sort();
console.log(`${headers.length} file(s) under @ts-nocheck (baseline ${BASELINE}):`);
for (const file of headers) {console.log(`  ${file}`);}
if (headers.length > BASELINE) {
  console.error(`\nRatchet slipped: ${headers.length - BASELINE} new @ts-nocheck header(s). Convert the file instead.`);
  process.exit(1);
}
if (headers.length < BASELINE) {
  console.log(`\n${BASELINE - headers.length} below baseline — lower BASELINE in scripts/ratchet-check.js.`);
}
