// A class typed into the well, styled, and taken off again — the whole panel.
//
//   node test/class-round-trip.js
//
// What the user did: select an element, type `.x` into the selector well, give
// it a padding, watch the canvas catch up, then click the chip's ×. Three things
// went wrong in a row, and all three had one cause. The panel kept the node
// OBJECT it was handed at selection time, while every edit clones the model —
// so the class went into the model and never into the object the panel read its
// snapshot from. The chip stayed dashed after its first property (the matcher
// found no source to trust over a page that hadn't re-rendered), came up GREEN
// once the page did (a class the page has and the source "doesn't" is, by the
// chips' own rule, a component's), and carried no × (not an authored class).
// A fourth, separate: the filter that hides a removed class compared bare names
// to `class:`-prefixed tokens, and hid nothing — the chip stayed until the page
// stopped reporting the class.
//
// The page is a fake frame that answers queries from a class list this test
// advances by hand, so "the dev server re-rendered" is one line here.

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
  const bundlePath = path.join(buildDir, 'class-round-trip.bundle.js');
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
  global.IS_REACT_ACT_ENVIRONMENT = false; // watched mid-flight, on purpose
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.Element.prototype.scrollIntoView = () => {};

  const SHEET = { rel: 'src/styles/main.css', name: 'main.css', path: '/p/src/styles/main.css', size: 10 };
  let sheet = '.card { color: red }';
  const writes = [];
  dom.window.avb = {
    listStyleFiles: async () => ({ files: [SHEET] }),
    listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }),
    readStyleFile: async () => ({ css: sheet }),
    writeStyleFile: async ({ css }) => { sheet = css; writes.push(css); return { ok: true }; },
  };
  const { EmbedEditor, setHost, setCanvasFrame, receiveCanvasReply } = require(bundlePath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');

  // The rendered page: what the element carries on the canvas right now. The
  // test moves it by hand where the dev server would.
  const RENDERED = [];
  const matchesRendered = (sel) => {
    if (sel === 'div') return true;
    const m = sel.match(/^((?:\.[\w-]+)+)$/);
    return !!m && m[1].split('.').filter(Boolean).every((c) => RENDERED.includes(c));
  };
  setCanvasFrame({
    postMessage: (m) => {
      if (m.type !== 'avb:query') return;
      setTimeout(() => receiveCanvasReply({
        id: m.id, ready: true, found: true, computed: {}, computedProps: {},
        identity: { tag: 'div', id: null, classes: [...RENDERED], attributes: {} },
        matched: Object.fromEntries((m.selectors || []).map((s) => [s, matchesRendered(s)])),
      }), 15);
    },
  });

  const setInput = (input, value) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const key = (el, k) => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

  // Two elements, one scenario each: a component instance (renders `.card` of
  // its own — the case that came up green) and a plain empty div.
  const cases = [
    { label: 'a component instance', node: { id: 'n1', kind: 'component', name: 'Card', props: {} }, rendered: ['card'] },
    { label: 'an empty div', node: { id: 'n2', kind: 'element', name: 'div', props: {} }, rendered: [] },
  ];
  for (const { label, node, rendered } of cases) {
    RENDERED.length = 0;
    RENDERED.push(...rendered);
    // The model, cloned on every edit the way the app's is — the panel must
    // read the class off the CURRENT node, not the one it was handed.
    let NODES = [{ ...node, props: { ...node.props } }];
    const calls = { add: [], remove: [] };
    const setClassAttr = (value) => {
      const props = { ...NODES[0].props };
      if (value) props.class = { type: 'string', value };
      else delete props.class;
      NODES = [{ ...NODES[0], props }];
      setHost({ nodes: NODES });
    };
    setHost({
      projectPath: '/p', nodes: NODES, selectedId: node.id, files: [SHEET], astroFiles: [],
      renderedClasses: [...RENDERED], pathOf: () => '0', acceptsClass: true, recordUndo: () => {},
      openFilePath: '/p/src/pages/index.astro',
      addClass: (name) => { calls.add.push(name); const cur = NODES[0].props.class?.value || ''; setClassAttr(cur ? `${cur} ${name}` : name); return true; },
      removeClass: (name) => { calls.remove.push(name); setClassAttr((NODES[0].props.class?.value || '').split(/\s+/).filter((c) => c && c !== name).join(' ')); },
    });
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    const root = createRoot(panel);
    root.render(React.createElement(EmbedEditor));
    const chip = (text) => [...panel.querySelectorAll('.embed-editor_selector-chip')].find((el) => el.textContent === text);
    const state = (text) => [...(chip(text)?.classList || [])].filter((c) => c.startsWith('is-')).join(',') || '(no chip)';
    await sleep(1200);
    // 0. Nothing is picked for a fresh element: the panel shows the sum of
    // everything reaching it, and a class's own values wait for a click on
    // its chip. Picking one on the user's behalf narrowed the view to a single
    // rule before they had asked for any.
    check(`${label}: nothing is picked on selection`, !panel.querySelector('.embed-editor_selector-chip.is-active'), [...panel.querySelectorAll('.embed-editor_selector-chip')].map((el) => el.className).join(' | '));

    // 1. `.x` typed into the well: lands on the element, shows as a dashed blue chip.
    panel.querySelector('.embed-editor_selector-well').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await sleep(50);
    const add = panel.querySelector('.embed-editor_selector-add');
    add.focus();
    setInput(add, '.x');
    key(add, 'Enter');
    await sleep(300);
    check(`${label}: the typed class is put on the element`, calls.add.join() === 'x', calls.add.join());
    check(`${label}: and shows as a pending chip, selected`, /is-pending/.test(state('.x')) && /is-active/.test(state('.x')), state('.x'));
    check(`${label}: blue — it was written on this element`, /is-added/.test(state('.x')), state('.x'));

    // 2. Its first property, before the page has re-rendered with the class.
    panel.querySelector('.embed-editor_add-btn').click();
    await sleep(50);
    const row = panel.querySelector('.embed-editor_decl.is-add');
    setInput(row.querySelector('input'), 'padding');
    setInput(row.querySelector('.embed-editor_value-input'), '10px');
    key(row.querySelector('.embed-editor_value-input'), 'Enter');
    await sleep(400);
    check(`${label}: the rule is written to the stylesheet`, /\.x \{ padding: 10px; \}/.test(sheet), sheet);
    check(`${label}: the chip fills in at once, ahead of the page`, !/is-pending/.test(state('.x')) && !!chip('.x'), state('.x'));
    check(`${label}: still blue`, /is-added/.test(state('.x')), state('.x'));
    await sleep(1800);
    check(`${label}: and stays so while the page lags`, !/is-pending/.test(state('.x')) && /is-added/.test(state('.x')), state('.x'));

    // 3. The dev server re-renders the element with the class.
    RENDERED.push('x');
    setHost({ renderedClasses: [...RENDERED] });
    await sleep(700);
    check(`${label}: once the page has the class the chip is still blue, never green`, /is-added/.test(state('.x')) && !/is-composed/.test(state('.x')), state('.x'));
    if (rendered.length) check(`${label}: the component's own class stays green`, /is-composed/.test(state(`.${rendered[0]}`)), state(`.${rendered[0]}`));

    // 4. The ×.
    const wrap = chip('.x')?.closest('.embed-editor_selector-chip-wrap');
    const x = wrap?.querySelector('.embed-editor_selector-remove');
    check(`${label}: the chip carries a ×`, !!x, wrap?.innerHTML);
    x?.click();
    await sleep(120);
    check(`${label}: clicking it takes the class off the element`, calls.remove.join() === 'x' && !NODES[0].props.class, JSON.stringify(NODES[0].props));
    check(`${label}: and the chip is gone at once, before the page catches up`, !chip('.x'), state('.x'));
    RENDERED.splice(RENDERED.indexOf('x'), 1);
    setHost({ renderedClasses: [...RENDERED] });
    await sleep(700);
    check(`${label}: and stays gone once it has`, !chip('.x'), state('.x'));

    // 4b. The class is off the element but its rule is in the stylesheet — the
    // shape of a class created on one element and wanted on the next. The app's
    // project list knows nothing of it (its own writes trigger no rescan), so
    // the well offers what it has parsed itself.
    panel.querySelector('.embed-editor_selector-well').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await sleep(50);
    const seek = panel.querySelector('.embed-editor_selector-add');
    seek.focus();
    setInput(seek, 'x');
    await sleep(50);
    const offers = [...panel.querySelectorAll('.embed-editor_suggest-item')].map((el) => el.textContent);
    check(`${label}: a class styled in a stylesheet is offered even before the app lists it`, offers.some((o) => /^\.x(class|new class)?$/.test(o.replace(/\s/g, ''))) , JSON.stringify(offers));
    check(`${label}: as an existing class, not a new one`, offers.some((o) => o.replace(/\s/g, '') === '.xclass'), JSON.stringify(offers));
    key(seek, 'Escape');
    seek.blur();
    await sleep(50);

    // 5. A bare word — `my-div`, no dot. As a selector it names an element
    // called <my-div>, which is never what someone typing it here means; the
    // rule it wrote styled nothing and the chip stayed dashed for good. It is
    // the class.
    panel.querySelector('.embed-editor_selector-well').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await sleep(50);
    const again = panel.querySelector('.embed-editor_selector-add');
    again.focus();
    setInput(again, 'my-div');
    await sleep(50);
    const offered = [...panel.querySelectorAll('.embed-editor_suggest-item')].map((el) => el.textContent);
    check(`${label}: a bare word is offered as the class it would create`, offered[0]?.startsWith('.my-div'), JSON.stringify(offered));
    key(again, 'Enter');
    await sleep(300);
    check(`${label}: and applied as that class`, calls.add.join() === 'x,my-div', calls.add.join());
    check(`${label}: with its chip named as one`, !!chip('.my-div') && !chip('my-div'), JSON.stringify([...panel.querySelectorAll('.embed-editor_selector-chip')].map((el) => el.textContent)));

    // 6. A second class, then the canvas catching up with both. The well is the
    // element's class list: a class with no rule still has its (dashed) chip,
    // the chips read in the order the classes were added — not the order their
    // rules happen to sit in a stylesheet — and the pick stays on the class
    // just typed when the page reports it, rather than jumping back to the
    // element's first class.
    panel.querySelector('.embed-editor_selector-well').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    await sleep(50);
    const third = panel.querySelector('.embed-editor_selector-add');
    third.focus();
    setInput(third, '.zz');
    key(third, 'Enter');
    await sleep(300);
    const own = () => [...panel.querySelectorAll('.embed-editor_selector-chip')].map((el) => el.textContent).filter((t) => t === '.my-div' || t === '.zz');
    check(`${label}: both classes have a chip, neither styled`, own().join(' ') === '.my-div .zz' && chip('.my-div')?.classList.contains('is-pending') && chip('.zz')?.classList.contains('is-pending'), JSON.stringify(own()));
    check(`${label}: the one just typed is the pick`, chip('.zz')?.classList.contains('is-active'), state('.zz'));
    RENDERED.push('my-div', 'zz');
    setHost({ renderedClasses: [...RENDERED] });
    await sleep(700);
    check(`${label}: the page catching up keeps the order`, own().join(' ') === '.my-div .zz', JSON.stringify(own()));
    check(`${label}: and keeps the pick`, chip('.zz')?.classList.contains('is-active'), state('.zz'));
    RENDERED.splice(0, RENDERED.length, ...rendered);

    root.unmount();
    panel.remove();
    sheet = '.card { color: red }';
  }

  if (failures.length) {
    console.error(`class-round-trip: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`class-round-trip: ${checked} passed  [type a class, style it, take it off]`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
