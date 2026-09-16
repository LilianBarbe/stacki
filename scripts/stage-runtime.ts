// Keep the runtime self-contained: content workers and icons are authored assets,
// copied beside compiled code so development and packaged paths stay identical.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// An explicit inventory bounds the copy and excludes signing material.
const files = [
  'electron/content/introspect.mjs',
  'electron/content/schemaTools.mjs',
  'electron/content/stub-astro-content.mjs',
  'electron/content/stub-astro-loaders.mjs',
  'resources/icon-dock.png',
  'resources/icon.icns',
  'resources/icon.ico',
  'resources/icon.png',
] as const;

for (const file of files) {
  const target = resolve(root, 'dist', file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
}
