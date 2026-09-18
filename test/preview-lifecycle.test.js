// Goal: preview frames retain their lifecycle and render the paths users interact with.
// Methodology: mount the real preview, deliver iframe messages, and answer only
// requested measurements so a missing hover subscription cannot pass unnoticed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

const dir = path.join(__dirname, '..', 'node_modules', '.stacki-test', 'preview-lifecycle');
fs.mkdirSync(dir, { recursive: true });
esbuild.buildSync({
  stdin: {
    contents: "export { default as PreviewPane, deviceForWidth } from './src/panels/PreviewPane.tsx'; export { hasCanvas, queryCanvas } from './src/canvasQuery.js';",
    resolveDir: path.join(__dirname, '..'), loader: 'jsx',
  },
  outfile: path.join(dir, 'preview.js'), bundle: true, format: 'cjs', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  loader: { '.css': 'empty' }, logLevel: 'silent',
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('canvas hover measures and outlines the active copy, then clears on leave', async () => {
  const dom = installHoverDOM();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { PreviewPane } = require(path.join(dir, 'preview.js'));
  const root = createRoot(document.getElementById('root'));
  const props = hoverPreviewProps();
  const act = (action) => React.act(async () => { await action(); await settle(); });
  const render = () => act(() => root.render(React.createElement(PreviewPane, props)));
  try {
    await render();
    const frame = document.querySelector('iframe').contentWindow;
    const tracked = [];
    frame.postMessage = (message) => {
      if (message.type === 'avb:track') {tracked.push(message.paths);}
    };
    const send = (data, source = frame) => act(() =>
      window.dispatchEvent(new window.MessageEvent('message', { source, data })),
    );
    const boxes = [{ x: 10, y: 30, w: 80, h: 40 }, { x: 10, y: 90, w: 80, h: 40 }];
    const measure = () => send({
      type: 'avb:rects', classes: {}, spacing: {},
      rects: Object.fromEntries(tracked.at(-1).map((nodePath) => [nodePath, boxes])),
    });
    await send({ type: 'avb:hover-node', path: '1', occurrence: 1 });
    assert.deepEqual(tracked.at(-1), ['0', '1', '2'], 'Hover joins selection and focus tracking');
    await measure();
    assert.equal(document.querySelectorAll('.node-outline.hover').length, 1);
    assert.equal(document.querySelector('.node-outline.hover').style.top, '90px');
    assert.equal(document.querySelectorAll('.node-outline.sel').length, 2);
    const trackCount = tracked.length;
    await send({ type: 'avb:hover-node', path: '1', occurrence: 0 });
    assert.equal(tracked.length, trackCount, 'Moving between copies reuses their measurements');
    assert.equal(document.querySelector('.node-outline.hover').style.top, '30px');
    props.navHoverPath = '3';
    await render();
    assert.deepEqual(tracked.at(-1), ['0', '3', '2']);
    await measure();
    assert.equal(document.querySelectorAll('.node-outline.hover').length, 2);
    props.navHoverPath = null;
    await render();
    assert.deepEqual(tracked.at(-1), ['0', '1', '2'], 'Canvas hover resumes after navigator hover');
    await measure();
    await send({ type: 'avb:hover-node', path: null, occurrence: 0 }, window);
    assert.equal(document.querySelectorAll('.node-outline.hover').length, 1);
    await send({ type: 'avb:hover-node', path: null, occurrence: 0 });
    assert.deepEqual(tracked.at(-1), ['0', '2']);
    assert.equal(document.querySelector('.node-outline.hover'), null);
    assert.equal(document.querySelectorAll('.node-outline.sel').length, 2);
  } finally {
    await act(() => root.unmount());
    dom.window.close();
  }
});

function installHoverDOM() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
    global[key] = key === 'window' ? dom.window : dom.window[key];
  }
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

function hoverPreviewProps() {
  return {
    devUrl: 'http://localhost:4321', route: '/', devStatus: 'on', device: 'desktop',
    selPath: '0', navHoverPath: null, focusPath: '2', crumbs: [], onDevice() {},
    overlayInfo: () => ({
      label: 'Card', kind: 'element', tag: 'div', nodeKind: 'element',
      astroAsset: false, dynamicTag: false, isLayout: false, bound: false,
    }),
  };
}

test('preview owns only mounted frames and cleans canceled/unmounted drags', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) {
    global[key] = key === 'window' ? window : window[key];
  }
  global.getComputedStyle = window.getComputedStyle;
  global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  global.cancelAnimationFrame = clearTimeout;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  window.ResizeObserver = global.ResizeObserver;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const { PreviewPane, deviceForWidth, hasCanvas, queryCanvas } = require(path.join(dir, 'preview.js'));
  const root = createRoot(document.getElementById('root'));
  let selected = [];
  const props = { devUrl: 'http://localhost:4321', route: '/', devStatus: 'on', device: 'desktop', onDevice: (key) => selected.push(key), crumbs: [], selPath: '0', pathScope: '', focusPath: null };
  const render = async (patch = {}) => {
    Object.assign(props, patch);
    await act(async () => { root.render(React.createElement(PreviewPane, props)); await settle(); });
  };
  const send = async (source, data) => act(async () => {
    window.dispatchEvent(new window.MessageEvent('message', { source, data }));
    await settle();
  });
  const pointer = (target, type, extra = {}) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0, clientX: 100, clientY: 100, ...extra }));
  await render();
  assert.equal(hasCanvas(), true);
  const oldFrame = document.querySelector('iframe').contentWindow;
  const navigationMessages = [];
  oldFrame.postMessage = (message) => navigationMessages.push(message);
  const scrolls = () => navigationMessages.filter((message) => message.type === 'avb:scroll-to');
  await render({ selPath: '0.1', pathScope: '', focusPath: null });
  assert.equal(scrolls().at(-1)?.path, '0.1', 'ordinary selections still reveal the selected element');
  navigationMessages.length = 0;
  await render({ selPath: 'src/components/Card.astro|0', pathScope: 'src/components/Card.astro|', focusPath: '0.1' });
  assert.equal(scrolls().length, 0, 'entering a component retains the canvas scroll position');
  await render({ selPath: 'src/components/Button.astro|0', pathScope: 'src/components/Button.astro|', focusPath: '0.1' });
  assert.equal(scrolls().length, 0, 'entering a nested component retains scroll even when the outer focus is unchanged');
  await render({ selPath: 'src/components/Card.astro|0', pathScope: 'src/components/Card.astro|', focusPath: '0.1' });
  assert.equal(scrolls().length, 0, 'closing a nested component retains scroll');
  await render({ selPath: 'src/components/Card.astro|0.1' });
  assert.equal(scrolls().at(-1)?.path, 'src/components/Card.astro|0.1', 'selections within the open component still reveal elements');
  navigationMessages.length = 0;
  await render({ selPath: '0', pathScope: '', focusPath: null });
  assert.equal(scrolls().length, 0, 'closing the component retains scroll');
  assert.equal(document.querySelector('iframe').contentWindow, oldFrame, 'component navigation retains the same loaded frame');
  const pendingQuery = queryCanvas('0');
  await render({ device: 'canvas' });
  assert.equal(hasCanvas(), false);
  assert.equal(await pendingQuery, null);
  assert.equal(document.querySelectorAll('iframe').length, 3);
  const canvasFrame = document.querySelector('iframe').contentWindow;
  await send(canvasFrame, { type: 'avb:page-height', height: NaN });
  assert.equal(document.querySelector('.canvas-frame').style.height, '900px');
  await send(canvasFrame, { type: 'avb:page-height', height: Infinity });
  assert.equal(document.querySelector('.canvas-frame').style.height, '900px');
  await send(canvasFrame, { type: 'avb:page-height', height: 80000 });
  assert.equal(document.querySelector('.canvas-frame').style.height, '30000px');
  await send(oldFrame, { type: 'avb:page-height', height: 1000 });
  assert.equal(document.querySelector('.canvas-frame').style.height, '30000px');
  await render({ refreshKey: 1 });
  assert.equal(document.querySelector('.canvas-frame').style.height, '900px');
  await act(async () => { pointer(document.querySelector('.canvas-view'), 'pointerdown'); await settle(); });
  assert.ok(document.querySelector('.canvas-view').classList.contains('panning'));
  await act(async () => { pointer(window, 'pointercancel'); await settle(); });
  assert.equal(document.querySelector('.canvas-view').classList.contains('panning'), false);
  await render({ device: 'tablet' });
  assert.equal(hasCanvas(), true);
  const replacementCalls = [];
  await render({ onDevice: (key) => replacementCalls.push(key) });
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3' })); await settle(); });
  assert.deepEqual(replacementCalls, ['phone']);
  assert.deepEqual(selected, []);
  document.body.style.cursor = 'crosshair';
  await act(async () => { pointer(document.querySelector('.rz-e'), 'pointerdown'); await settle(); });
  assert.equal(document.body.style.cursor, 'col-resize');
  await act(async () => { window.dispatchEvent(new window.Event('blur')); await settle(); });
  assert.equal(document.body.style.cursor, 'crosshair');
  await act(async () => { pointer(document.querySelector('.rz-s'), 'pointerdown'); await settle(); });
  assert.equal(document.body.style.cursor, 'row-resize');
  await act(async () => root.unmount());
  assert.equal(document.body.style.cursor, 'crosshair');
  assert.equal(hasCanvas(), false);
  assert.deepEqual([767, 768, 1023, 1024, NaN, 0].map(deviceForWidth), ['phone', 'tablet', 'tablet', 'desktop', null, null]);
  dom.window.close();
});
