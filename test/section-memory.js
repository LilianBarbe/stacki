// The style panel's sections stay however they were last put.
//
//   node test/section-memory.js
//
// Close Spacing on one element and it was closed on the next — as long as the
// panel stayed mounted. Switch to the Settings tab and back, or land on an
// element the section doesn't apply to, and it came back open: a block's
// collapse state lived in the block, and a remounted block starts over. The
// state now lives with the panel's preferences, by section id, and a block
// mounts to it — across elements, tabs and launches. CSS Code keeps its own
// older key as well, so nothing that read it changes.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundlePath = path.join(buildDir, 'section-memory.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { default as EmbedEditor } from './EmbedEditor'
        export { setHost } from './lib/host'
        export { loadSectionsOpen } from './shared/tool-prefs'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'tsx',
    },
    outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.localStorage = dom.window.localStorage;
  global.IS_REACT_ACT_ENVIRONMENT = false;
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  global.MutationObserver = dom.window.MutationObserver;
  global.Window = dom.window.Window;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.Element.prototype.scrollIntoView = () => {};

  const SHEET = { rel: 'src/styles/main.css', name: 'main.css', path: '/p/src/styles/main.css', size: 10 };
  dom.window.avb = {
    listStyleFiles: async () => ({ files: [SHEET] }),
    listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }),
    readStyleFile: async () => ({ css: '.card { padding: 1rem }' }),
    writeStyleFile: async () => ({ ok: true }),
  };
  const { EmbedEditor, setHost, loadSectionsOpen } = require(bundlePath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');

  const NODES = [
    { id: 'n1', kind: 'element', name: 'div', props: { class: { type: 'string', value: 'card' } } },
    { id: 'n2', kind: 'element', name: 'p', props: {} },
  ];
  setHost({ projectPath: '/p', nodes: NODES, selectedId: 'n1', files: [SHEET], astroFiles: [], renderedClasses: ['card'], pathOf: () => '0' });

  const panel = document.createElement('div');
  document.body.appendChild(panel);
  let root = createRoot(panel);
  root.render(React.createElement(EmbedEditor));
  await sleep(600);

  const section = (label) => [...panel.querySelectorAll('.embed-editor_section-block')].find((b) => b.querySelector('.embed-editor_section-title')?.textContent === label);
  const collapsed = (label) => !!section(label)?.classList.contains('is-collapsed');
  const toggle = (label) => section(label)?.querySelector('.embed-editor_section-toggle')?.click();

  check('Spacing starts open', section('Spacing') && !collapsed('Spacing'));
  check('CSS Code starts closed', collapsed('CSS Code'));
  toggle('Spacing');
  toggle('CSS Code');
  await sleep(100);
  check('closing Spacing closes it', collapsed('Spacing'));
  check('opening CSS Code opens it', !collapsed('CSS Code'));
  const saved = loadSectionsOpen();
  check('both choices are saved, by section id', saved.spacing === false && saved['css-code'] === true, JSON.stringify(saved));
  check('CSS Code keeps its older key too', dom.window.localStorage.getItem('moden.embedEditor.cssCodeOpen') === '1');

  // Another element: the choice comes along.
  setHost({ selectedId: 'n2', renderedClasses: [] });
  await sleep(400);
  check('on the next element Spacing is still closed', collapsed('Spacing'));

  // The panel goes (the Settings tab, say) and comes back: still as left.
  root.unmount();
  await sleep(50);
  root = createRoot(panel);
  root.render(React.createElement(EmbedEditor));
  await sleep(600);
  check('after a remount Spacing is still closed', collapsed('Spacing'), section('Spacing')?.className);
  check('and CSS Code still open', !collapsed('CSS Code'), section('CSS Code')?.className);
  check('a section never touched keeps its default', section('Layout') && !collapsed('Layout'));

  // Shift-click: every section goes the way the clicked one is going.
  const shiftClick = (label) => section(label)?.querySelector('.embed-editor_section-toggle')?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  shiftClick('Layout'); // open → closing it closes them all
  await sleep(100);
  const all = () => [...panel.querySelectorAll('.embed-editor_section-block')];
  check('Shift-click on an open section closes every section', all().every((b) => b.classList.contains('is-collapsed')), all().map((b) => b.querySelector('.embed-editor_section-title')?.textContent + (b.classList.contains('is-collapsed') ? ':closed' : ':open')).join(' '));
  shiftClick('Spacing'); // closed → opening it opens them all
  await sleep(100);
  check('Shift-click on a closed one opens every section', all().every((b) => !b.classList.contains('is-collapsed')), all().map((b) => b.querySelector('.embed-editor_section-title')?.textContent + (b.classList.contains('is-collapsed') ? ':closed' : ':open')).join(' '));
  check('and that is remembered too', Object.values(loadSectionsOpen()).every(Boolean) && loadSectionsOpen().spacing === true, JSON.stringify(loadSectionsOpen()));

  if (failures.length) {
    console.error(`section-memory: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`section-memory: ${checked} passed  [sections stay as they were put]`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
