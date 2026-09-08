// The canvas is told a live value directly, ahead of the file.
//
//   node test/live-css.js
//
// A drag on the spacing box used to reach the canvas the long way round: file
// written, dev server notified, page fetched and patched — some 400 ms, on
// every tick, so the outline trailed the number by half a second. Now the rule
// being edited is re-spelled from its live AST and posted to the frame, which
// holds it in a <style> of its own at the end of <head> until the file has
// caught up. Two halves: the text the panel sends (lib/live-css.ts), and what
// the frame does with it (electron/preload.js).

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  // --- the text -----------------------------------------------------------------
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundlePath = path.join(buildDir, 'live-css.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { liveCssOf, previewLiveCss, settleLiveCss } from './lib/live-css'
        export { collectRules } from './lib/css'
        export { setCanvasFrame } from '../canvasQuery.js'
        export { default as postcss } from 'postcss'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'ts',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { liveCssOf, previewLiveCss, settleLiveCss, collectRules, setCanvasFrame, postcss } = require(bundlePath);

  const rulesOf = (css) => {
    const root = postcss.parse(css);
    return collectRules({ start: 0, end: css.length, css, root }, {
      embedKey: 'k', embedLabel: 'l', fromComponent: false, componentName: null, regionIndex: 0, idSeed: 'k', order: { n: 0 },
    });
  };

  {
    const [rule] = rulesOf('.footer_links { display: flex; padding-bottom: 2rem }');
    check('a rule is re-spelled with its own declarations', liveCssOf(rule) === '.footer_links { display: flex; padding-bottom: 2rem; }', liveCssOf(rule));
    // The AST is what a live edit mutates, so the text follows it.
    rule.node.nodes[1].value = '5rem';
    check('and follows the live AST', /padding-bottom: 5rem;/.test(liveCssOf(rule)), liveCssOf(rule));
  }
  {
    const rules = rulesOf('@layer components { @media (width >= 64rem) { .a { gap: 1rem !important; .b { color: red } } } }');
    const a = rules.find((r) => r.selectorText === '.a');
    const b = rules.find((r) => r.selectorText === '.a .b');
    check('a query wraps it the way the file does', liveCssOf(a) === '@media (width >= 64rem) { .a { gap: 1rem !important; } }', liveCssOf(a));
    check('a nested rule is spelled resolved, with only its own declarations', liveCssOf(b) === '@media (width >= 64rem) { .a .b { color: red; } }', liveCssOf(b));
  }

  // What is posted to the frame.
  const posted = [];
  setCanvasFrame({ postMessage: (m) => posted.push(m) });
  const [rule] = rulesOf('.x { top: 1px }');
  previewLiveCss(rule);
  settleLiveCss();
  check('a preview posts the rule', posted[0]?.type === 'avb:live-css' && posted[0].css === '.x { top: 1px; }', JSON.stringify(posted[0]));
  check('and a commit only says to settle', posted[1]?.type === 'avb:live-css' && posted[1].settle === true && !('css' in posted[1]), JSON.stringify(posted[1]));

  // --- the frame ------------------------------------------------------------------
  // The preload's outline half, in a frame of its own, the way test/outlines.js
  // runs it.
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><head><style data-vite-dev-id="/a.css">.x{top:1px}</style></head><body></body></html>', {
    url: 'http://localhost:4321/#avb-design',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.navigator = window.navigator;
  global.MutationObserver = window.MutationObserver;
  global.Element = window.Element;
  global.Node = window.Node;
  global.MouseEvent = window.MouseEvent;
  global.CustomEvent = window.CustomEvent;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.parent = { postMessage: () => {} };
  const Module = require('module');
  const electron = {
    contextBridge: { exposeInMainWorld: () => {} },
    ipcRenderer: { on: () => {}, send: () => {}, invoke: async () => {} },
    webUtils: {},
  };
  const realRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    return id === 'electron' ? electron : realRequire.apply(this, arguments);
  };
  process.isMainFrame = false;
  require(path.join(__dirname, '..', 'electron', 'preload.js'));
  Module.prototype.require = realRequire;
  await sleep(50);

  const tell = (data) => {
    const ev = new window.MessageEvent('message', { data });
    Object.defineProperty(ev, 'source', { value: window.parent });
    window.dispatchEvent(ev);
  };
  const sheet = () => window.document.querySelector('style.avb-live-css');

  tell({ type: 'avb:live-css', css: '.x { top: 5px; }' });
  check('the rule lands in a <style> of its own', sheet()?.textContent === '.x { top: 5px; }', sheet()?.outerHTML);
  check('last in <head>, after the dev stylesheets', window.document.head.lastElementChild === sheet());
  tell({ type: 'avb:live-css', css: '.x { top: 6px; }' });
  check('a new value replaces it rather than adding a second', window.document.querySelectorAll('style.avb-live-css').length === 1 && sheet().textContent === '.x { top: 6px; }');

  // The file is written: the sheet stays until the page has caught up.
  tell({ type: 'avb:live-css', settle: true });
  await sleep(20);
  check('settling does not drop it on the spot', !!sheet());
  // The dev server swaps the real stylesheet in.
  window.document.querySelector('style[data-vite-dev-id]').textContent = '.x{top:6px}';
  await sleep(20);
  check('a stylesheet changing in <head> is the page catching up', !sheet(), sheet()?.outerHTML);

  // The other way the page catches up: the patcher's own event.
  tell({ type: 'avb:live-css', css: '.x { top: 7px; }' });
  tell({ type: 'avb:live-css', settle: true });
  await sleep(20);
  window.document.dispatchEvent(new window.CustomEvent('avb:morphed'));
  await sleep(0);
  check('and so is a patch', !sheet());

  // A value arriving while settling means the drag went on: it is live again.
  tell({ type: 'avb:live-css', css: '.x { top: 8px; }' });
  tell({ type: 'avb:live-css', settle: true });
  tell({ type: 'avb:live-css', css: '.x { top: 9px; }' });
  await sleep(20);
  window.document.dispatchEvent(new window.CustomEvent('avb:morphed'));
  await sleep(0);
  check('a value after settle keeps the preview alive', sheet()?.textContent === '.x { top: 9px; }', sheet()?.outerHTML);

  // Settling with no sheet is nothing to do.
  tell({ type: 'avb:live-css', settle: true });
  await sleep(20);
  window.document.dispatchEvent(new window.CustomEvent('avb:morphed'));
  await sleep(0);
  check('and it goes when that edit lands', !sheet());
  tell({ type: 'avb:live-css', settle: true });
  check('settling with nothing showing is harmless', !sheet());

  if (failures.length) {
    console.error(`live-css: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`live-css: ${checked} passed  [the canvas is told a live value ahead of the file]`);
  process.exit(0);
})();
