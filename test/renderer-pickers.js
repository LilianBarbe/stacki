// Render the real pickers with shared React. Valid data retains selected/missing
// rows, while oversized and cyclic inputs fail before unbounded traversal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const directory = path.join(__dirname, '..', 'node_modules', '.stacki-test');
fs.mkdirSync(directory, { recursive: true });
const output = path.join(directory, 'renderer-pickers.bundle.cjs');
buildSync({
  stdin: {
    contents: `export { default as DataPicker } from './src/ui/DataPicker.tsx';
    export { default as InsertSearch } from './src/ui/InsertSearch.tsx';`,
    resolveDir: path.join(__dirname, '..'),
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
const { DataPicker, InsertSearch } = require(output);
const leaf = { path: 'post', key: 'post', kind: 'object', preview: '', children: null };
const renderData = (props) =>
  renderToStaticMarkup(
    React.createElement(DataPicker, {
      tree: [],
      onPick() {},
      ...props,
    }),
  );
assert.match(renderData({ tree: [leaf], current: 'post.title' }), /not in this entry/);
assert.match(renderData({ tree: [leaf], current: 'post' }), /dp-row selected/);
assert.throws(() => renderData({ tree: Array(20001).fill(leaf) }), /node limit exceeded/);
assert.throws(() => renderData({ current: 'x'.repeat(8193) }), /binding path limit exceeded/);
const cyclic = { ...leaf, children: [] };
cyclic.children.push(cyclic);
assert.throws(() => renderData({ tree: [cyclic] }), /depth limit exceeded/);
assert.throws(
  () =>
    renderToStaticMarkup(
      React.createElement(InsertSearch, {
        components: Array(10001).fill({ name: 'Card' }),
        onInsert() {},
        onClose() {},
      }),
    ),
  /component limit exceeded/,
);
console.log('renderer-pickers: selected/missing rows and traversal bounds passed');
