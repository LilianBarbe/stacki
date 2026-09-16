// Run a renderer module through the app's bundler before testing it in Node.
// Temporary bundles keep tests independent of extension inference and TS emit.
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = function loadRenderer(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-renderer-module-'));
  const output = path.join(directory, 'module.cjs');
  try {
    buildSync({
      entryPoints: [path.join(__dirname, '..', 'src', name)],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    });
    return require(output);
  } finally {
    delete require.cache[output];
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
