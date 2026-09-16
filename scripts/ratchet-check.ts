#!/usr/bin/env node
// The unchecked-file baseline only shrinks. New opt-outs fail immediately,
// and the migration is complete only when this reaches zero.

import fs = require('node:fs');
import path = require('node:path');

const BASELINE = 0;
const FILES_MAX = 100_000;
const ROOTS = ['src', 'electron', 'scripts', 'test', 'shared'] as const;
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs)$/;

const root = path.join(__dirname, '..', '..');
const headers: string[] = [];
const pending = ROOTS.map((directory) => path.join(root, directory));
let visited = 0;

while (pending.length > 0) {
  visited += 1;
  if (visited > FILES_MAX) {
    throw new Error(`Ratchet scan exceeds ${FILES_MAX} paths`);
  }
  const current = pending.pop();
  if (current === undefined || !fs.existsSync(current)) {
    continue;
  }
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      pending.push(fullPath);
      continue;
    }
    if (!SOURCE_EXTENSION.test(entry.name)) {
      continue;
    }
    const relativePath = path.relative(root, fullPath);
    if (relativePath === path.join('scripts', 'ratchet-check.ts')) {
      continue;
    }
    const head = fs.readFileSync(fullPath, 'utf8').slice(0, 4096);
    if (head.includes('@ts-nocheck')) {
      headers.push(relativePath);
    }
  }
}

headers.sort();
console.log(`${headers.length} file(s) under @ts-nocheck (baseline ${BASELINE}):`);
for (const filePath of headers) {
  console.log(`  ${filePath}`);
}
if (headers.length > BASELINE) {
  console.error(`\nRatchet slipped by ${headers.length - BASELINE} file(s).`);
  process.exitCode = 1;
} else if (headers.length < BASELINE) {
  console.log(`\n${BASELINE - headers.length} below baseline — lower BASELINE.`);
}
