// Keep the runtime self-contained: content workers and icons are authored assets,
// copied beside compiled code so development and packaged paths stay identical.
import fileSystemPromises = require('node:fs/promises');
import path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
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

async function main(): Promise<void> {
  for (const file of files) {
    const target = path.resolve(root, 'dist', file);
    await fileSystemPromises.mkdir(path.dirname(target), { recursive: true });
    await fileSystemPromises.copyFile(path.resolve(root, file), target);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
