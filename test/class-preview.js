// A class tried on the page, from the style panel's family menu.
//
//   node test/class-preview.js
//
// Hovering `margin-bottom-4` in the menu over an element wearing
// `margin-bottom-2` shows the swap on the canvas and nowhere else: the file and
// the chip keep the original until a class is chosen. A utility class can hold
// any rule, so the only way to preview one is for the element to wear it — the
// frame swaps the class on the element itself, and swaps it back when told.

const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

(async () => {
  const Module = require('module');
  const { JSDOM } = require('jsdom');
  const marked = (p, html) => `<!--avb-s:${p}-->${html}<!--avb-e:${p}-->`;
  const dom = new JSDOM(
    `<!doctype html><body>
      ${marked('0.1', '<h2 class="heading margin-bottom-2" data-avb-p="0.1">Hi</h2>')}
      ${marked('0.2', '<p class="margin-bottom-2" data-avb-p="0.2">There</p>')}
    </body>`,
    { url: 'http://localhost:4321/#avb-design', pretendToBeVisual: true }
  );
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
  await new Promise((resolve) => setTimeout(resolve, 50));

  const tell = (data) => {
    const ev = new window.MessageEvent('message', { data });
    Object.defineProperty(ev, 'source', { value: window.parent });
    window.dispatchEvent(ev);
  };
  const h2 = window.document.querySelector('h2');
  const p = window.document.querySelector('p');

  tell({ type: 'avb:class-preview', path: '0.1', from: 'margin-bottom-2', to: 'margin-bottom-4' });
  check('the element wears the hovered class', h2.classList.contains('margin-bottom-4'), h2.className);
  check('in place of the one it had', !h2.classList.contains('margin-bottom-2'), h2.className);
  check('and keeps the rest', h2.classList.contains('heading'), h2.className);
  check('only that element', p.className === 'margin-bottom-2', p.className);

  tell({ type: 'avb:class-preview', path: '0.1', from: 'margin-bottom-4', to: 'margin-bottom-8' });
  check('the next hover swaps the preview', h2.className === 'heading margin-bottom-8', h2.className);

  tell({ type: 'avb:class-preview', path: '0.1', from: 'margin-bottom-8', to: 'margin-bottom-2' });
  check('told to, it puts the original back', h2.className === 'heading margin-bottom-2', h2.className);

  tell({ type: 'avb:class-preview', path: '9.9', from: 'margin-bottom-2', to: 'margin-bottom-4' });
  check('a path nothing renders at is nothing to wear', h2.className === 'heading margin-bottom-2' && p.className === 'margin-bottom-2');

  if (failures.length) {
    console.error(`class-preview: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`class-preview: ${checked} passed  [a class tried on the page, then taken off]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
