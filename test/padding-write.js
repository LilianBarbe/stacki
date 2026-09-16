// Padding commits compact the rule, and the panel reads the compact form back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

(async () => {
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundle = path.join(buildDir, 'padding-write.bundle.js');
  await require('esbuild').build({
    stdin: {
      contents: `
        export { default as EmbedEditor } from './EmbedEditor'
        export { setHost } from './lib/host'
        export { setPaddingDeclaration, clearPaddingSides, spacingSides } from './lib/padding'
        export { parseRegion, createRuleAtRoot, createRuleInQuery, createNestedRule } from './lib/css'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'), loader: 'tsx',
    },
    outfile: bundle, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  for (const key of ['MutationObserver', 'Element', 'HTMLElement', 'Node']) global[key] = dom.window[key];
  for (const key of ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) global[key] = dom.window[key].bind(dom.window);
  dom.window.Element.prototype.setPointerCapture = () => {};
  dom.window.Element.prototype.releasePointerCapture = () => {};
  const { EmbedEditor, setHost, setPaddingDeclaration, clearPaddingSides, spacingSides, parseRegion, createRuleAtRoot, createRuleInQuery } = require(bundle);
  const sides = ['top', 'right', 'bottom', 'left'];
  const decls = (rule) => rule.nodes.filter((n) => n.type === 'decl' && n.prop.startsWith('padding'))
    .map((d) => [d.prop, d.value, !!d.important]);
  const edit = (source, edits) => {
    const rule = postcss.parse(`.card { ${source} }`).first;
    for (const [prop, value, important = false] of edits) setPaddingDeclaration(rule, prop, value, important);
    return rule;
  };
  const all = (values) => sides.map((s, i) => [`padding-${s}`, values[i]]);
  const cases = [
    [['2.56rem', '2.56rem', '2.56rem', '2.56rem'], [['padding', '2.56rem', false]]],
    [['1rem', '2rem', '1rem', '2rem'], [['padding-block', '1rem', false], ['padding-inline', '2rem', false]]],
    [['1rem', '2rem', '3rem', '2rem'], [['padding-top', '1rem', false], ['padding-bottom', '3rem', false], ['padding-inline', '2rem', false]]],
    [['1rem', '2rem', '1rem', '4rem'], [['padding-block', '1rem', false], ['padding-right', '2rem', false], ['padding-left', '4rem', false]]],
    [['1rem', '2rem', '3rem', '4rem'], [['padding-top', '1rem', false], ['padding-bottom', '3rem', false], ['padding-right', '2rem', false], ['padding-left', '4rem', false]]],
  ];
  for (const [values, expected] of cases) {
    assert.deepEqual(decls(edit('color: red; padding: 2rem;', all(values))), expected);
  }
  assert.deepEqual(decls(edit('', [['padding-left', '2rem']])), [['padding-left', '2rem', false]], 'no inherited sides invented');
  assert.deepEqual(decls(edit('padding: 2rem;', [['padding-left', '3rem']])), [
    ['padding-block', '2rem', false], ['padding-right', '2rem', false], ['padding-left', '3rem', false],
  ]);
  assert.deepEqual(decls(edit('padding: 2rem; padding-top: 9rem;', [['padding', '3rem']])), [['padding', '3rem', false]], 'editing the shorthand replaces old overrides');
  assert.deepEqual(decls(edit('padding: 2rem !important;', sides.map((s) => [`padding-${s}`, '3rem', true]))), [['padding', '3rem', true]]);
  const mixed = edit('padding: 2rem;', [['padding-top', '2rem', true]]);
  assert.deepEqual(decls(mixed), [['padding-top', '2rem', true], ['padding-bottom', '2rem', false], ['padding-inline', '2rem', false]], 'importance is part of equality');
  assert.deepEqual(decls(edit('padding: var(--spacing);', all(Array(4).fill('3rem')))), [['padding', '3rem', false]], 'overridden variable shorthand removed');
  const opaque = edit('padding: var(--spacing);', [['padding-top', '3rem']]);
  assert.deepEqual(decls(opaque), [['padding', 'var(--spacing)', false], ['padding-top', '3rem', false]], 'unknown multi-value variables preserved');
  const nested = edit('color: red; padding: 2rem; /* keep */ & .child { padding: 7rem; }', all(Array(4).fill('3rem')));
  assert.equal(nested.nodes.find((n) => n.prop === 'color').value, 'red');
  assert.equal(nested.nodes.find((n) => n.type === 'comment').text, 'keep');
  assert.equal(nested.nodes.find((n) => n.type === 'rule').first.value, '7rem');
  assert.deepEqual(spacingSides('padding-inline', '2rem'), { 'padding-left': '2rem', 'padding-right': '2rem' });
  assert.deepEqual(spacingSides('padding-block', '1rem 3rem'), { 'padding-top': '1rem', 'padding-bottom': '3rem' });
  const cleared = edit('padding: 2rem !important;', []);
  assert.ok(clearPaddingSides(cleared, ['padding-top']));
  assert.deepEqual(decls(cleared), [['padding-bottom', '2rem', true], ['padding-inline', '2rem', true]]);
  clearPaddingSides(cleared, ['padding-left', 'padding-right', 'padding-bottom']);
  assert.deepEqual(decls(cleared), []);

  // New selectors and query overrides use the same compaction as existing rules.
  for (const query of [false, true]) {
    const region = { start: 0, end: 0, css: '', root: null };
    parseRegion(region);
    for (const side of sides) {
      if (query) createRuleInQuery(region, '@media (max-width: 600px)', '.card', `padding-${side}`, '3rem', false);
      else createRuleAtRoot(region, '.card', `padding-${side}`, '3rem', false);
    }
    const rule = query ? region.root.first.first : region.root.first;
    assert.deepEqual(decls(rule), [['padding', '3rem', false]]);
  }

  // Reproduce the user's actual Shift+drag through the mounted editor and disk bridge.
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const SHEET = { rel: 'src/styles/main.css', name: 'main.css', path: '/p/src/styles/main.css', size: 10 };
  let disk = '.color-faded { color: color-mix(in lab, currentColor 70%, transparent); padding: 2rem; }';
  dom.window.avb = {
    listStyleFiles: async () => ({ files: [SHEET] }), listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }), readStyleFile: async () => ({ css: disk }),
    writeStyleFile: async ({ css }) => { disk = css; return { ok: true }; },
  };
  setHost({ projectPath: '/p', nodes: [{ id: 'n1', kind: 'element', name: 'div', props: { class: { type: 'string', value: 'color-faded' } } }], selectedId: 'n1', files: [SHEET], astroFiles: [], renderedClasses: [], pathOf: () => '0.1' });
  const panel = document.getElementById('root');
  const root = createRoot(panel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = () => act(async () => { await wait(250); });
  await act(async () => { root.render(React.createElement(EmbedEditor)); });
  await settle();
  await act(async () => { panel.querySelector('.embed-editor_selector-chip').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await settle();
  const label = (side) => panel.querySelector(`button[data-prop="padding-${side}"]`);
  const drag = async (side, dx, dy, modifiers = {}) => {
    const button = label(side);
    assert.ok(button && !button.disabled, 'spacing label ready to drag');
    const send = (type, x, y) => act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...modifiers }));
      await wait(25);
    });
    await send('pointerdown', 100, 100);
    await send('pointermove', 100 + dx, 100 + dy);
    await send('pointerup', 100 + dx, 100 + dy);
    await settle();
  };
  await drag('top', 0, -18, { shiftKey: true });
  let saved = postcss.parse(disk).first;
  assert.equal(decls(saved).length, 1, disk);
  assert.equal(decls(saved)[0][0], 'padding', disk);
  const value = decls(saved)[0][1];
  assert.notEqual(value, '2rem');
  for (const side of sides) assert.equal(label(side).textContent, value, 'compacted value remains visible');
  assert.equal(saved.nodes.find((n) => n.prop === 'color').value, 'color-mix(in lab, currentColor 70%, transparent)');

  await drag('left', -16, 0, { altKey: true });
  saved = postcss.parse(disk).first;
  assert.deepEqual(decls(saved).map(([prop]) => prop), ['padding-block', 'padding-inline'], disk);
  assert.equal(label('left').textContent, label('right').textContent);
  assert.equal(label('top').textContent, label('bottom').textContent);
  assert.notEqual(label('left').textContent, label('top').textContent);

  await drag('top', 0, -16);
  saved = postcss.parse(disk).first;
  assert.deepEqual(decls(saved).map(([prop]) => prop), ['padding-top', 'padding-bottom', 'padding-inline'], disk);
  assert.notEqual(label('top').textContent, label('bottom').textContent);
  await act(async () => {
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      label('left').dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, altKey: true, clientX: 100, clientY: 100 }));
    }
  });
  await settle();
  saved = postcss.parse(disk).first;
  assert.deepEqual(decls(saved).map(([prop]) => prop), ['padding-top', 'padding-bottom', 'padding-right'], disk);
  assert.equal(label('left').textContent, '0', 'a grouped side can still be reset');
  await act(async () => { root.unmount(); });
  dom.window.close();
  console.log('padding-write: compaction, cascade, new rules and real Shift/Alt/single-side drags passed');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
