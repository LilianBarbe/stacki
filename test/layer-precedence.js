// Cascade layers: the panel ranks rules the way the browser does.
//
//   node test/layer-precedence.js
//
// A project declares `@layer base, patterns, utilities;` and imports a file
// into each. On the page, a `utilities` rule beats a `patterns` rule however
// specific either is, and an unlayered rule beats both. The panel ranked by
// specificity and source order alone: a two-class `patterns` rule was shown
// winning `margin-top` over the `utilities` class that actually won it, the
// spacing field said `0`, and the element sat 14px lower than the panel
// claimed. Three halves: the comparison itself, the layer each rule is read
// into (blocks and imports, whichever file comes first), and the panel over
// a project shaped like that one.

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

  // --- the comparison --------------------------------------------------------
  const libPath = path.join(buildDir, 'layer-precedence-lib.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { resetLayers, declareLayer, declaredLayers, compareLayerWin, comparePrecedence, resolveImportPath } from './lib/layers'
        export { compareCascade } from './lib/cascade'
        export { parseRegion, collectRules, scanLayerStatements } from './lib/css'
        export { rebuildRules } from './lib/webflow'
        export { setHost } from './lib/host'
        export { default as postcss } from 'postcss'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'ts',
    },
    outfile: libPath, bundle: true, format: 'cjs', platform: 'node', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const lib = require(libPath);
  const { resetLayers, declareLayer, declaredLayers, compareLayerWin, comparePrecedence, resolveImportPath, compareCascade, parseRegion, collectRules, scanLayerStatements, rebuildRules, postcss } = lib;

  resetLayers();
  declareLayer('base'); declareLayer('patterns'); declareLayer('utilities');
  const wins = (a, b, important) => compareLayerWin(a, b, important) < 0;
  check('a later layer beats an earlier one', wins('utilities', 'patterns') && !wins('patterns', 'utilities'));
  check('no layer beats every layer', wins(null, 'utilities') && !wins('utilities', null));
  check('the same layer decides nothing', compareLayerWin('base', 'base') === 0 && compareLayerWin(null, null) === 0);
  check('a rule directly in a layer beats one nested inside it', wins('patterns', 'patterns.inner') && !wins('patterns.inner', 'patterns'));
  check('nested layers rank inside their parent', wins('patterns.inner', 'base') && wins('utilities', 'patterns.inner'));
  check('a layer met for the first time takes the next slot', wins('late', 'utilities') && declaredLayers().includes('late'));
  check('!important reads the table backwards', wins('patterns', 'utilities', true) && wins('utilities', null, true));

  const p = (layer, specificity, order) => ({ layer, specificity, order });
  check('precedence: layer before specificity', comparePrecedence(p('utilities', [0, 1, 0], 1), p('patterns', [0, 2, 0], 9)) < 0);
  check('then specificity', comparePrecedence(p('utilities', [0, 2, 0], 1), p('utilities', [0, 1, 0], 9)) < 0);
  check('then the later rule', comparePrecedence(p('utilities', [0, 1, 0], 9), p('utilities', [0, 1, 0], 1)) < 0);
  const c = (layer, specificity, important = false) => ({ layer, specificity, important });
  check('the cascade comparator agrees', compareCascade(c('utilities', [0, 1, 0]), c('patterns', [0, 2, 0]), 1, 9) < 0);
  check('and lets !important through first', compareCascade(c('patterns', [0, 1, 0], true), c('utilities', [0, 2, 0]), 1, 9) < 0);
  check('an import path resolves beside its importer', resolveImportPath('/p/src/styles/global.css', './base.css') === '/p/src/styles/base.css' && resolveImportPath('/p/src/styles/global.css', 'url("../x/y.css")') === '/p/src/x/y.css', resolveImportPath('/p/src/styles/global.css', 'url("../x/y.css")'));

  // --- what each rule is read into ----------------------------------------------
  resetLayers();
  const css = '@layer a, b;\n@import "./b.css" layer(b);\n@layer a { .x { color: red } @layer inner { .y { color: blue } } }\n.z { color: green }\n@layer { .w { color: grey } }';
  const region = { start: 0, end: css.length, css, root: null };
  parseRegion(region);
  const seen = { declared: [], imported: [] };
  scanLayerStatements(region.root, { declare: (n) => seen.declared.push(n), imported: (spec, layer) => seen.imported.push(`${spec}>${layer}`) });
  check('layer statements, blocks and imports are all declarations, in order', seen.declared.join(' ') === 'a b b a <anonymous 1>', seen.declared.join(' '));
  check('an import names its file and its layer', seen.imported.join() === '"./b.css">b', seen.imported.join());
  const rules = collectRules(region, { embedKey: 'k', embedLabel: 'l', fromComponent: false, componentName: null, regionIndex: 0, idSeed: 'k', order: { n: 0 } });
  const layerOf = (sel) => rules.find((r) => r.selectorText === sel)?.layer;
  check('a rule in a block is in that layer', layerOf('.x') === 'a', layerOf('.x'));
  check('a nested block nests the name', layerOf('.y') === 'a.inner', layerOf('.y'));
  check('a rule outside any block has none', layerOf('.z') === null, String(layerOf('.z')));
  check('an anonymous block is a layer of its own', /^<anonymous/.test(layerOf('.w') || ''), layerOf('.w'));
  const imported = collectRules(region, { embedKey: 'k2', embedLabel: 'l', fromComponent: false, componentName: null, regionIndex: 0, idSeed: 'k2', order: { n: 0 }, layer: 'b' });
  check('a file imported into a layer puts every rule there', imported.find((r) => r.selectorText === '.z')?.layer === 'b');

  // Files read on their own, the importer LAST — the layer still reaches them.
  const doc = (order, p, code) => {
    const root = postcss.parse(code);
    return { source: { key: `file:${p}`, label: p, classNames: [], fromComponent: false, componentName: null, order, element: p, origin: { kind: 'file', path: p } }, code, segments: ['', ''], regions: [{ start: 0, end: code.length, css: code, root }] };
  };
  const rebuilt = rebuildRules([
    doc(0, '/p/styles/patterns.css', '.layout > .heading { margin-top: 0 }'),
    doc(1, '/p/styles/utilities.css', '.margin-top-0 { margin-top: 0 }\n.color-faded { margin-top: var(--space-3) }'),
    doc(2, '/p/styles/global.css', '@layer base, patterns, utilities;\n@import "./patterns.css" layer(patterns);\n@import "./utilities.css" layer(utilities);'),
  ]);
  const layerIn = (sel) => rebuilt.find((r) => r.selectorText === sel)?.layer;
  check('a sheet read before the file that imports it still gets its layer', layerIn('.layout > .heading') === 'patterns' && layerIn('.color-faded') === 'utilities', `${layerIn('.layout > .heading')} / ${layerIn('.color-faded')}`);
  check('and the declared order is the statement\'s', declaredLayers().join(' ') === 'base patterns utilities', declaredLayers().join(' '));

  // --- the panel over such a project ----------------------------------------------
  const panelPath = path.join(buildDir, 'layer-precedence-panel.bundle.js');
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
    outfile: panelPath, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'], loader: { '.css': 'empty' }, logLevel: 'silent',
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
  global.Window = dom.window.Window;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.Element.prototype.scrollIntoView = () => {};

  const FILES = {
    '/p/src/styles/global.css': '@layer base, patterns, utilities;\n@import "./patterns.css" layer(patterns);\n@import "./utilities.css" layer(utilities);',
    '/p/src/styles/patterns.css': '.layout > .heading { margin-top: 0 }',
    '/p/src/styles/utilities.css': '.margin-top-0 { margin-top: 0 }\n.color-faded { color: grey; margin-top: var(--space-3) }',
  };
  const file = (p) => ({ rel: p.replace('/p/', ''), name: p.split('/').pop(), path: p, size: 1 });
  // Alphabetical, as the app lists them: the importer first here, but the
  // rebuild does not rely on it (see the doc test above).
  const files = Object.keys(FILES).sort().map(file);
  dom.window.avb = {
    listStyleFiles: async () => ({ files }),
    listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }),
    readStyleFile: async (p) => ({ css: FILES[p] ?? '' }),
    writeStyleFile: async () => ({ ok: true }),
  };
  const { EmbedEditor, setHost, setCanvasFrame, receiveCanvasReply } = require(panelPath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const RENDERED = ['heading', 'color-faded', 'margin-top-0'];
  const matches = (sel) => sel === '.layout > .heading' || (/^((?:\.[\w-]+)+)$/.test(sel) && sel.slice(1).split('.').every((c) => RENDERED.includes(c)));
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
  const h2 = { id: 'n1', kind: 'element', name: 'h2', props: { class: { type: 'string', value: 'heading color-faded margin-top-0' } }, children: [] };
  const layout = { id: 'l', kind: 'element', name: 'div', props: { class: { type: 'string', value: 'layout' } }, children: [h2] };
  setHost({
    projectPath: '/p', nodes: [layout], selectedId: 'n1', files, astroFiles: [], renderedClasses: [...RENDERED],
    pathOf: () => '0.0', acceptsClass: true, recordUndo: () => {}, openFilePath: '/p/src/pages/index.astro',
  });
  const panel = document.createElement('div');
  document.body.appendChild(panel);
  createRoot(panel).render(React.createElement(EmbedEditor));
  await sleep(1500);

  const chips = () => [...panel.querySelectorAll('.embed-editor_selector-chip')].map((el) => el.textContent);
  const sections = () => [...panel.querySelectorAll('.embed-editor_section-block')];
  const named = (label) => sections().find((b) => b.querySelector('.embed-editor_section-title')?.textContent === label);
  const marginTop = () => named('Spacing')?.querySelector('[data-prop="margin-top"]')?.textContent;
  check('the spacing field shows the utilities value the page applies', marginTop() === 'var(--space-3)', marginTop());
  const styledChips = () => [...panel.querySelectorAll('.embed-editor_selector-chip')].filter((el) => !el.classList.contains('is-pending')).map((el) => el.textContent);
  check('the utility that wins is the last styled chip', styledChips()[styledChips().length - 1] === '.color-faded', chips().join(' '));
  panel.querySelector('.embed-editor_inherited-check input')?.click();
  await sleep(80);
  check('the more specific patterns rule reads above both utilities — it lost', chips().indexOf('.layout > .heading') < chips().indexOf('.margin-top-0'), chips().join(' '));

  named('CSS Code')?.querySelector('.embed-editor_section-toggle')?.click();
  await sleep(300);
  const { EditorView } = require('@codemirror/view');
  const ed = named('CSS Code')?.querySelector('.cm-editor');
  const text = ed ? EditorView.findFromDOM(ed).state.doc.toString() : '';
  check('the stacked view leads with the winner', text.startsWith('/* src/styles/utilities.css · @layer utilities */\n.color-faded {'), JSON.stringify(text.slice(0, 80)));
  check('and names the layer of the rule that lost on it', /@layer patterns \*\/\n\.layout > \.heading \{/.test(text), JSON.stringify(text));
  const struck = [...(named('CSS Code')?.querySelectorAll('.cm-struck') || [])].map((e) => e.textContent);
  check('the two margin-tops that lose are struck', struck.length === 2 && struck.every((t) => t === 'margin-top: 0;'), JSON.stringify(struck));

  if (failures.length) {
    console.error(`layer-precedence: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`layer-precedence: ${checked} passed  [the browser's layer order, in the panel]`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
