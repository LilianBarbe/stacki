const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('a loading panel preserves its siblings and receives the latest props', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { build } = require('esbuild');
  const result = await build({
    entryPoints: [path.join(__dirname, '../src/ui/lazyPanel.jsx')],
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react'],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  let resolvePanel;
  let loads = 0;
  const Panel = mod.exports.lazyPanel(() => {
    loads++;
    return new Promise((resolve) => { resolvePanel = resolve; });
  });
  const root = createRoot(document.getElementById('root'));
  const view = (show, label) => React.createElement(React.Suspense, { fallback: 'Editor loading' },
    React.createElement('input', { defaultValue: 'canvas state' }),
    show && React.createElement(Panel, { label }));
  try {
    await React.act(async () => root.render(view(false, 'first')));
    const input = document.querySelector('input');
    input.value = 'preserved';
    await React.act(async () => root.render(view(true, 'first')));
    assert.equal(document.querySelector('input'), input);
    assert.equal(input.style.display, '');
    assert.ok(!document.body.textContent.includes('Editor loading'));
    await React.act(async () => root.render(view(true, 'latest')));
    await React.act(async () => resolvePanel({
      default: ({ label }) => React.createElement('p', null, label),
    }));
    assert.equal(document.querySelector('p').textContent, 'latest');
    assert.equal(input.value, 'preserved');
    assert.equal(loads, 1);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
