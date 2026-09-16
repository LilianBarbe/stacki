// Goal: component usage replies cannot put malformed files or counts into the popup.
// Methodology: parse valid success/error variants, then exercise nested fields,
// totals, duplicates, and collection bounds; also pin deterministic grouping.
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('./renderer-module')('paletteModel.ts');

const file = {
  rel: 'src/pages/about.astro',
  path: '/project/src/pages/about.astro',
  kind: 'page',
  count: 2,
};

test('component usage parser preserves success and operating-error variants', () => {
  assert.deepEqual(model.parseComponentUsage({ files: [file], total: 2 }), {
    kind: 'ready',
    files: [file],
  });
  assert.deepEqual(model.parseComponentUsage({ error: 'scan failed' }), {
    kind: 'error',
    message: 'scan failed',
  });
});

test('component usage parser rejects invalid nested values, totals, and bounds', () => {
  for (const value of [
    null,
    {},
    { error: 'failed', files: [] },
    { files: [{ ...file, rel: 'bad\0path' }] },
    { files: [{ ...file, kind: 'other' }] },
    { files: [{ ...file, count: 0 }] },
    { files: [file], total: 3 },
    { files: [file, file], total: 4 },
    { files: Array(100_001).fill(file) },
  ]) {
    assert.throws(() => model.parseComponentUsage(value));
  }
});

test('component groups keep the root first and folders in name order', () => {
  const component = (name, folder) => ({ path: `/p/${name}.astro`, name, folder });
  assert.deepEqual(
    model
      .groupPaletteComponents([
        component('Zed', 'Z'),
        component('Root', ''),
        component('Alpha', 'A'),
        component('Again', 'A'),
      ])
      .map(([folder, items]) => [folder, items.map((item) => item.name)]),
    [
      ['', ['Root']],
      ['A', ['Alpha', 'Again']],
      ['Z', ['Zed']],
    ],
  );
});
