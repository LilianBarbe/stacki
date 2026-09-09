// The CSS Code section in the style panel.
//
//   node test/css-code-panel.js
//
// The panel's first section is the picked selector's CSS as text: every rule
// for it in the file, together, editable. Typing there writes the file on a
// short debounce, only once the text parses, and the other panels follow from
// the file as they do for any edit. The pieces that would fail quietly: the
// section rendering somewhere other than first, text that does not parse
// being written anyway, and the file's formatted copy of what was typed
// replacing the typed text under the caret once the write comes back.
//
// Mounted over the whole panel with a stylesheet behind it, so the text
// really comes out of the rules the panel resolved and the write really goes
// through its save path.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = false;
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.DOMRect = dom.window.DOMRect;
  global.Window = dom.window.Window;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.localStorage = dom.window.localStorage;
  // CodeMirror measures itself; jsdom has no layout to measure.
  dom.window.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  dom.window.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });

  const React = require('react');
  const { createRoot } = require('react-dom/client');

  const bundle = path.join(buildDir, 'css-code-panel.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { default as EmbedEditor } from './EmbedEditor'
        export { setHost } from './lib/host'
        export { EditorView } from '@codemirror/view'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'tsx',
    },
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });

  const SOURCE = [
    ':root { --brand: #f04; --space-4: 1rem }',
    '.hero { padding: 1rem }',
    '.card { color: red }',
    '.card:hover { color: blue }',
    '@media (width >= 64rem) {',
    '  .card { padding: 2rem }',
    '}',
    '',
  ].join('\n');
  const SHEET = { rel: 'src/styles/main.css', name: 'main.css', path: '/p/src/styles/main.css', size: 10 };
  let disk = SOURCE;
  const writes = [];
  dom.window.avb = {
    listStyleFiles: async () => ({ files: [SHEET] }),
    listAstroStyleFiles: async () => ({ files: [] }),
    listAssets: async () => ({ entries: [] }),
    readStyleFile: async () => ({ css: disk }),
    writeStyleFile: async ({ css }) => { disk = css; writes.push(css); return { ok: true }; },
  };

  const { EmbedEditor, setHost, EditorView } = require(bundle);
  const NODES = [
    { id: 'n1', kind: 'element', name: 'div', props: { class: { type: 'string', value: 'card' } } },
  ];

  const panel = document.createElement('div');
  document.body.appendChild(panel);
  const root = createRoot(panel);
  const wait = (ms) => new Promise((r) => dom.window.setTimeout(r, ms));
  const settled = async (ms = 4000) => {
    let last = panel.innerHTML;
    let stableSince = Date.now();
    const until = Date.now() + ms;
    for (;;) {
      await wait(50);
      const now = panel.innerHTML;
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 200) return;
      if (Date.now() > until) return;
    }
  };

  setHost({ projectPath: '/p', nodes: NODES, selectedId: 'n1', files: [SHEET], astroFiles: [], renderedClasses: ['card'], pathOf: () => '0' });
  root.render(React.createElement(EmbedEditor));
  await settled();

  const sections = () => [...panel.querySelectorAll('.embed-editor_section-block')];
  const titleOf = (block) => block.querySelector('.embed-editor_section-title')?.textContent?.trim();
  const section = () => sections().find((b) => titleOf(b) === 'CSS Code');
  const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const editor = () => section()?.querySelector('.cm-editor');
  const view = () => (editor() ? EditorView.findFromDOM(editor()) : null);
  const text = () => view()?.state.doc.toString();
  const foot = () => section()?.querySelector('.embed-editor_css-code-foot')?.textContent ?? '';

  // ── Where it is, and how it starts ──

  check('the CSS Code section is on the panel', !!section(), sections().map(titleOf).join(' | '));
  check('and it comes first', sections()[0] && titleOf(sections()[0]) === 'CSS Code', sections().map(titleOf).join(' | '));
  check('it starts collapsed', section()?.classList.contains('is-collapsed'));

  // ── Nothing picked: the sum ──
  //
  // Selecting an element picks no class. The section then stacks every rule
  // reaching the element, read-only, winners first, with the declarations
  // that lose the cascade marked to be struck through — the DevTools view.
  click(section().querySelector('.embed-editor_section-toggle'));
  await settled();
  check('opening it shows an editor', !!editor());
  check('and remembers that it is open', dom.window.localStorage.getItem('moden.embedEditor.cssCodeOpen') === '1');
  check('with nothing picked it stacks every rule reaching the element in this query', text() === '/* src/styles/main.css */\n.card {\n  color: red;\n}\n', JSON.stringify(text()));
  check('a rule in another query waits for that query, like the fields do', !(text() || '').includes('padding'));
  check('read-only', !!editor()?.closest('.code-editor')?.classList.contains('is-readonly'));
  check('and says what it is', foot().startsWith('Everything reaching this element'), foot());
  check('no file in the header — it is several', !section()?.querySelector('.embed-editor_css-code-file'));

  // ── Picking a chip: that selector's own CSS ──
  click([...panel.querySelectorAll('.embed-editor_selector-chip')].find((c) => c.textContent.trim() === '.card'));
  await settled();
  check('its header names the file, as the source picker does', section()?.querySelector('.embed-editor_css-code-file')?.textContent === 'src/styles/main.css',
    section()?.querySelector('.embed-editor_css-code-file')?.textContent);
  check('the editor holds every rule for the picked selector, base and @media, formatted',
    text() === '.card {\n  color: red;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n', JSON.stringify(text()));
  check(':hover is not in it, being a selector of its own', !(text() || '').includes(':hover'));
  check('the line under it says which file', foot().startsWith('In src/styles/main.css'), foot());

  // ── Typing writes the file ──

  const type = (from, to, insert) => { view().dispatch({ changes: { from, to, insert }, userEvent: 'input.type' }); };
  const at = (s) => text().indexOf(s);

  type(at('red'), at('red') + 3, 'green');
  await wait(150);
  check('nothing is written before the debounce', writes.length === 0, `${writes.length} writes`);
  await wait(400);
  await settled();
  check('after it, the file is written once', writes.length === 1, `${writes.length} writes`);
  check('with the changed rule and nothing else touched',
    disk === SOURCE.replace('.card { color: red }', '.card {\n  color: green;\n}'), disk);
  check('the typed text stays as typed', text() === '.card {\n  color: green;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n', JSON.stringify(text()));

  // The file comes back holding the same thing in its own layout; the text is
  // not swapped for it under the caret.
  view().dispatch({ changes: { from: 0, to: text().length, insert: '.card{color:teal}@media (width >= 64rem){.card{padding:2rem}}' }, userEvent: 'input.type' });
  await wait(450);
  await settled();
  check('a compact rewrite is written', writes.length === 2 && disk.includes('color: teal'), `${writes.length} writes:\n${disk}`);
  check('and the editor keeps the compact text, not the file\'s formatted copy',
    text() === '.card{color:teal}@media (width >= 64rem){.card{padding:2rem}}', JSON.stringify(text()));

  // ── Text that does not parse waits ──

  const unclosed = '.card{color:te}@media (width >= 64rem){.card{padding:2rem}';
  view().dispatch({ changes: { from: 0, to: text().length, insert: unclosed }, userEvent: 'input.type' });
  await wait(450);
  await settled();
  check('an unclosed rule is not written', writes.length === 2, `${writes.length} writes:\n${disk}`);
  check('and the section says so', foot().startsWith('Not saved'), foot());
  type(text().length, text().length, '}');
  await wait(450);
  await settled();
  check('closing it writes', writes.length === 3 && disk.includes('color: te'), `${writes.length} writes:\n${disk}`);
  check('and the note stands down', foot().startsWith('In src/styles/main.css'), foot());

  // ── Another chip, another document ──

  const chip = [...panel.querySelectorAll('.embed-editor_selector-chip')].find((c) => c.textContent.trim() === '.card:hover');
  check('the :hover chip is on the panel', !!chip, [...panel.querySelectorAll('.embed-editor_selector-chip')].map((c) => c.textContent.trim()).join(' | '));
  if (chip) {
    click(chip);
    await settled();
    check('picking it shows that selector\'s CSS', text() === '.card:hover {\n  color: blue;\n}\n', JSON.stringify(text()));
  }

  // ── Completion ──

  // Typing `var(--sp` in a value opens the project's variables.
  if (chip) {
    const insertAt = text().indexOf('blue;') + 'blue;'.length;
    view().dispatch({ changes: { from: insertAt, insert: '\n  padding: var(--sp' }, selection: { anchor: insertAt + '\n  padding: var(--sp'.length }, userEvent: 'input.type' });
    let list = null;
    for (let i = 0; i < 40 && !list; i++) {
      await wait(50);
      list = document.body.querySelector('.cm-tooltip-autocomplete');
    }
    check('typing var(-- opens the completion list', !!list, 'no .cm-tooltip-autocomplete on the page');
    const rows = list ? [...list.querySelectorAll('li')].map((li) => li.textContent) : [];
    check('with the project\'s variables that match, value beside the name', rows.some((r) => r.includes('--space-4') && r.includes('1rem')), JSON.stringify(rows));
    check('and not the ones that do not', !rows.some((r) => r.includes('--brand')), JSON.stringify(rows));
    check('and the half-typed rule is not written meanwhile', writes.length === 3, `${writes.length} writes`);
  }

  root.unmount();
  panel.remove();

  if (failures.length) {
    console.error(`css-code-panel: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-panel: ${checked} passed  [first section, writes on debounce, keeps typed text, waits on bad CSS, completes variables]`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
