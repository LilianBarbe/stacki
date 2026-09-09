// The order of the chips in the well: Chrome DevTools' order.
//
//   node test/chip-devtools-order.js
//
// The rule that wins sits at the top — precedence descending: specificity
// first, and between equals the rule written later above the one written
// earlier. Two orders came before and both misled: stylesheet order ascending
// put the loser first, and the class attribute's order said nothing about the
// cascade at all (`color-faded` sat below `margin-top-0` while its own
// `margin-top` was winning). A class with no rule yet has no place in the
// cascade and goes last.

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
  const bundlePath = path.join(buildDir, 'chip-devtools-order.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { default as EmbedEditor } from './EmbedEditor'
        export { setHost } from './lib/host'
        export { setCanvasFrame, receiveCanvasReply } from '../canvasQuery.js'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'tsx',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = false;
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.Element.prototype.scrollIntoView = () => {};

  // Written in this order: the reset, then `.faded` (which sets margin-top),
  // then `.mt-0`, then a chain from an ancestor. The element carries its
  // classes in the OTHER order, plus one nobody has styled yet.
  const SHEET = { rel: 'src/styles/main.css', name: 'main.css', path: '/p/src/styles/main.css', size: 10 };
  const css = [
    'h2 { margin: 0 }',
    '.faded { opacity: .6; margin-top: 1rem }',
    '.mt-0 { margin-top: 0 }',
    '.hero h2 { color: red }',
  ].join('\n');
  dom.window.avb = {
    listStyleFiles: async () => ({ files: [SHEET] }),
    listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }),
    readStyleFile: async () => ({ css }),
    writeStyleFile: async () => ({ ok: true }),
  };
  const { EmbedEditor, setHost, setCanvasFrame, receiveCanvasReply } = require(bundlePath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');

  const RENDERED = ['mt-0', 'faded', 'fresh'];
  const matches = (sel) => {
    if (sel === 'h2' || sel === '.hero h2') return true;
    const m = sel.match(/^((?:\.[\w-]+)+)$/);
    return !!m && m[1].split('.').filter(Boolean).every((c) => RENDERED.includes(c));
  };
  setCanvasFrame({
    postMessage: (m) => {
      if (m.type !== 'avb:query') return;
      setTimeout(() => receiveCanvasReply({
        id: m.id, ready: true, found: true, computed: {}, computedProps: {},
        identity: { tag: 'h2', id: null, classes: [...RENDERED], attributes: {} },
        matched: Object.fromEntries((m.selectors || []).map((s) => [s, matches(s)])),
      }), 15);
    },
  });
  const hero = { id: 'h', kind: 'element', name: 'section', props: { class: { type: 'string', value: 'hero' } }, children: [] };
  const h2 = { id: 'n1', kind: 'element', name: 'h2', props: { class: { type: 'string', value: 'mt-0 faded fresh' } }, children: [] };
  hero.children = [h2];
  setHost({
    projectPath: '/p', nodes: [hero], selectedId: 'n1', files: [SHEET], astroFiles: [], renderedClasses: [...RENDERED],
    pathOf: () => '0.0', acceptsClass: true, recordUndo: () => {}, openFilePath: '/p/src/pages/index.astro',
  });
  const panel = document.createElement('div');
  document.body.appendChild(panel);
  createRoot(panel).render(React.createElement(EmbedEditor));
  await sleep(1500);

  const chips = () => [...panel.querySelectorAll('.embed-editor_selector-chip')].map((el) => el.textContent);
  check('the class whose rule is written later — the one winning margin-top — sits first', chips()[0] === '.mt-0', chips().join(' '));
  check('the one it beats comes next, whatever the class attribute says', chips()[1] === '.faded', chips().join(' '));
  check('a class with no rule yet goes last', chips()[chips().length - 1] === '.fresh', chips().join(' '));
  check('and is dashed', panel.querySelectorAll('.embed-editor_selector-chip')[chips().length - 1]?.classList.contains('is-pending'));

  // The grey ones, revealed: the ancestor chain outranks every lone class,
  // the bare tag ranks below them all.
  panel.querySelector('.embed-editor_inherited-check input')?.click();
  await sleep(80);
  check('an ancestor chain, more specific, sits above the classes', chips()[0] === '.hero h2', chips().join(' '));
  check('the tag reset, least specific, sits below them', chips().indexOf('h2') > chips().indexOf('.faded'), chips().join(' '));
  check('and still above the class with no rule', chips().indexOf('h2') < chips().indexOf('.fresh'), chips().join(' '));

  if (failures.length) {
    console.error(`chip-devtools-order: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`chip-devtools-order: ${checked} passed  [winners first, as DevTools lists them]`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
