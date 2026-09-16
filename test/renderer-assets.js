// Asset response contracts reject malformed paths, sizes, and collections before
// rendering. Scripted preload calls distinguish disk failures from contract bugs.
const assert = require('node:assert/strict');
const loadRenderer = require('./renderer-module');
const { parseAssetEntry, parseAssetEntries, listAssetEntries, resolveAssetImport } =
  loadRenderer('assetBridge.ts');
const file = {
  rel: 'public/a.png',
  name: 'a.png',
  parent: 'public',
  root: 'public',
  isDir: false,
  abs: '/p/public/a.png',
  size: 12,
};
const directory = {
  rel: 'public',
  name: 'public',
  parent: '',
  root: 'public',
  isDir: true,
  isRoot: true,
};
assert.deepEqual(parseAssetEntry(file), file);
assert.deepEqual(parseAssetEntry(directory), directory);
assert.deepEqual(parseAssetEntries({ entries: [directory, file] }).entries, [directory, file]);
for (const invalid of [
  null,
  [],
  {},
  { ...file, isDir: 'false' },
  { ...file, abs: null },
  { ...file, size: -1 },
  { ...file, size: 1.5 },
  { ...file, size: NaN },
  { ...file, size: Number.MAX_SAFE_INTEGER + 1 },
  { ...file, root: null },
  { ...file, rel: 'bad\0path' },
  { ...file, rel: 'x'.repeat(32769) },
  { ...directory, isRoot: 'true' },
]) {
  assert.throws(() => parseAssetEntry(invalid));
}
assert.throws(
  () => parseAssetEntries({ entries: Array(100001).fill(file) }),
  /Array exceeds limit/,
);
assert.throws(() => parseAssetEntries({ entries: null }), /Expected array/);
(async () => {
  global.window = { avb: { listAssets: async () => ({ entries: [file] }) } };
  assert.deepEqual(await listAssetEntries('/p'), { ok: true, value: [file] });
  window.avb.listAssets = async () => {
    throw new Error('disk unavailable');
  };
  assert.deepEqual(await listAssetEntries('/p'), { ok: false, error: 'disk unavailable' });
  window.avb.listAssets = async () => ({ entries: [null] });
  await assert.rejects(() => listAssetEntries('/p'), /Expected object/);
  const request = ['/p', '/p/src/pages/index.astro', '../assets/hero.png'];
  window.avb.resolveSourcePath = async (payload) => {
    assert.deepEqual(payload, { projectPath: request[0], fromFile: request[1], spec: request[2] });
    return { ok: true, rel: 'src/assets/hero.png' };
  };
  assert.deepEqual(await resolveAssetImport(...request), { ok: true, rel: 'src/assets/hero.png' });
  window.avb.resolveSourcePath = async () => ({ ok: false });
  assert.deepEqual(await resolveAssetImport(...request), { ok: false });
  window.avb.resolveSourcePath = async () => {
    throw new Error('unavailable');
  };
  assert.deepEqual(await resolveAssetImport(...request), { ok: false });
  for (const response of [
    null,
    {},
    { ok: true, rel: 0 },
    { ok: true, rel: 'x'.repeat(32769) },
    { ok: true, rel: 'bad\0path' },
  ]) {
    window.avb.resolveSourcePath = async () => response;
    await assert.rejects(() => resolveAssetImport(...request));
  }
  console.log('renderer-assets: parser bounds and operating-failure checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
