// Keep Vite alive while Electron restarts itself for “Reload All Code”. The
// supervisor mirrors every other exit so concurrently still owns shutdown.

import { spawn, type ChildProcess } from 'node:child_process';
const RELAUNCH_CODE = 42;
const argumentsList = process.argv.slice(2);
const HANDLED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

let child: ChildProcess | undefined;

function run(): void {
  const electronInput: unknown = require('electron');
  if (typeof electronInput !== 'string' || electronInput.length === 0) {
    throw new Error('Electron executable path must be a non-empty string');
  }
  const spawnedChild = spawn(electronInput, ['.', ...argumentsList], {
    stdio: 'inherit',
    env: process.env,
  });
  child = spawnedChild;
  spawnedChild.on('exit', (code, signal) => {
    child = undefined;
    if (code === RELAUNCH_CODE) {
      console.log('[dev] reloading all code…');
      run();
      return;
    }
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

for (const signal of HANDLED_SIGNALS) {
  process.on(signal, () => {
    if (child) {
      child.kill(signal);
    } else {
      process.exit(0);
    }
  });
}

run();
