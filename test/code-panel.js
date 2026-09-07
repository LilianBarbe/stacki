// The Code panel: a file, open at the selection.
//
//   node test/code-panel.js
//
// The left rail's Code tab opens the file behind whatever the canvas has
// selected — the page, or the component being edited — and turns down every
// line that isn't the selection. Three things about it are easy to break
// without noticing, and each is checked here against a real CodeMirror view:
//
//  - the dim is a state of the EDITOR, not of React: it comes on with a
//    selection, goes at the first click into the code, and stays off through
//    the refreshes that follow, until the canvas picks something else.
//  - the highlighted range follows the text. Typing a line above the section
//    must move the highlight down with it, or it lights the wrong lines.
//  - two flows write to one editor. Typing goes to disk, and the model is
//    read back; a save landing elsewhere refreshes the text in place. A
//    refresh that arrives while typing is still on its way to disk must NOT
//    win, or it eats the keystrokes.

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
  const bundle = path.join(buildDir, 'code-panel.bundle.js');
  await esbuild.build({
    stdin: {
      contents:
        `export { default as CodePanel } from './src/panels/CodePanel.jsx';\n` +
        `export { EditorView } from '@codemirror/view';\n` +
        `export { focusRangeOf, isDimmed } from './src/ui/codeFocus.js';\n` +
        `export { componentTagAt, setCmdLink } from './src/ui/cmdLink.js';\n`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'js',
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

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.MutationObserver = dom.window.MutationObserver;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.DOMRect = dom.window.DOMRect;
  global.Window = dom.window.Window;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  dom.window.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  dom.window.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });

  // ── The page, and what main would answer for it ──────────────────────────
  const REL = 'src/pages/index.astro';
  const PAGE = [
    '---',
    "import Layout from '../layouts/Layout.astro';",
    '---',
    '<Layout title="Home">',
    '  <section class="hero">',
    '    <h1>Hello</h1>',
    '  </section>',
    '  <section class="about">',
    '    <p>About us</p>',
    '  </section>',
    '  <section class="contact">',
    '    <p>Write to us</p>',
    '  </section>',
    '</Layout>',
    '',
  ].join('\n');
  // The third section, by tree position (Layout → its third child).
  const THIRD = `${REL}#0.2`;
  const BARE = `${REL}#`;

  // What the file reads as on disk: the tests move it under the panel.
  let disk = PAGE;
  const located = [];
  const writes = [];
  const events = [];
  // Main re-parses the file on every ask, so the section's lines are read off
  // the disk copy as it is now — after a line typed above it, they move.
  const contactLines = () => {
    const lines = disk.split('\n');
    const start = lines.findIndex((l) => l.includes('class="contact"'));
    const end = lines.findIndex((l, i) => i > start && l.includes('</section>'));
    return { startLine: start + 1, endLine: end + 1 };
  };
  dom.window.avb = {
    locateSelection: async ({ key }) => {
      located.push(key);
      if (key === THIRD) return { rel: REL, text: disk, ...contactLines() };
      if (key === BARE) return { rel: REL, text: disk, startLine: null, endLine: null };
      return null;
    },
    writeSourceText: async ({ rel, text }) => {
      writes.push({ rel, text });
      disk = text;
      events.push('write');
      return { ok: true };
    },
  };
  global.avb = dom.window.avb;

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const { CodePanel, EditorView, focusRangeOf, isDimmed, componentTagAt, setCmdLink } = require(bundle);

  const host = document.createElement('div');
  document.getElementById('root').appendChild(host);
  const root = createRoot(host);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const project = { path: '/p' };
  const settled = () => ({ editable: true, dirty: false, model: { nodes: [] } });
  let pageState = settled();
  const toasts = [];
  const opened = [];
  const render = async (props) => {
    await act(async () => {
      root.render(
        React.createElement(CodePanel, {
          project,
          pageState,
          flushSave: async () => events.push('flush'),
          onWritten: async () => events.push('reload'),
          onOpenComponent: (name) => opened.push(name),
          locked: false,
          showToast: (m) => toasts.push(m),
          ...props,
        })
      );
    });
    await act(async () => { await settle() });
  };

  const editor = () => host.querySelector('.cm-editor');
  const view = () => (editor() ? EditorView.findFromDOM(editor()) : null);
  const focusLines = () => [...host.querySelectorAll('.cm-focus-line')].map((l) => l.textContent.trim());
  const empty = () => host.querySelector('.code-panel-empty')?.textContent || null;

  // ── Nothing selected yet ─────────────────────────────────────────────────
  await render({ selectionKey: null });
  check('with no file open the panel asks for a selection', empty() === 'Select an element on the canvas', empty());
  check('and holds no editor', !editor());

  // ── The third section ────────────────────────────────────────────────────
  await render({ selectionKey: THIRD });
  check('a selection opens the file', !!editor(), host.innerHTML.slice(0, 200));
  check('the placeholder goes', !empty(), empty());
  check('the header names the file', host.querySelector('.code-panel-file')?.textContent === REL, host.querySelector('.code-panel-file')?.textContent);
  check('and the lines', host.querySelector('.code-panel-lines')?.textContent === 'L11–13', host.querySelector('.code-panel-lines')?.textContent);
  check('the whole file is in the editor', view()?.state.doc.toString() === PAGE);
  check('the section is the focused lines', focusLines().length === 3 && focusLines()[0].startsWith('<section class="contact">') && focusLines()[2] === '</section>', focusLines().join(' | '));
  check('and the rest is dimmed', editor()?.classList.contains('cm-dimmed'), editor()?.className);
  check('which the state agrees with', view() && isDimmed(view().state));
  check('the file was asked for once', located.filter((k) => k === THIRD).length === 1, located.join(', '));

  // ── The first click into the code ────────────────────────────────────────
  await act(async () => {
    host.querySelector('.cm-content').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
  });
  check('a click into the editor takes the dim off', !editor()?.classList.contains('cm-dimmed'), editor()?.className);
  check('but leaves the section marked', focusLines().length === 3, focusLines().join(' | '));

  // ── Typing above the section ─────────────────────────────────────────────
  await act(async () => {
    view().dispatch({ changes: { from: 0, insert: '<!-- top -->\n' } });
  });
  check('a line typed above moves the highlight down with the section', focusLines().length === 3 && focusLines()[0].startsWith('<section class="contact">'), focusLines().join(' | '));
  const range = focusRangeOf(view().state);
  check('the range now starts where the section does', range && view().state.doc.lineAt(range.from).number === 12, range && view().state.doc.lineAt(range.from).number);
  check('nothing is written before the pause', writes.length === 0, String(writes.length));

  // A save landing elsewhere while the typing is still in flight: the disk
  // copy is older than the editor, and must not replace it.
  pageState = settled();
  await render({ selectionKey: THIRD });
  check('a refresh while typing is pending leaves the editor alone', view().state.doc.toString().startsWith('<!-- top -->'), view().state.doc.toString().slice(0, 20));

  await act(async () => { await wait(400) });
  check('after the pause the text is written to the file it came from', writes.length === 1 && writes[0].rel === REL && writes[0].text.startsWith('<!-- top -->\n---'), JSON.stringify(writes.map((w) => w.rel)));
  check('pending model edits land first, then the write, then the model is read back', events.join(',') === 'flush,write,reload', events.join(','));

  // ── A save landing from elsewhere ────────────────────────────────────────
  // The model settles on disk with the file changed (say a props-panel edit
  // to the hero) — the panel refreshes in place and neither scrolls, writes
  // nor dims.
  disk = disk.replace('class="hero"', 'class="hero big"');
  events.length = 0;
  pageState = settled();
  await render({ selectionKey: THIRD });
  check('a settled model refreshes the text in place', view().state.doc.toString().includes('class="hero big"'), view().state.doc.toString().slice(0, 120));
  check('without turning the dim back on', !editor()?.classList.contains('cm-dimmed'), editor()?.className);
  check('and with the section still marked', focusLines().length === 3 && focusLines()[0].startsWith('<section class="contact">'), focusLines().join(' | '));
  await act(async () => { await wait(400) });
  check('a refresh is not typing: nothing is written back', writes.length === 1 && events.length === 0, `${writes.length} writes, events ${events.join(',')}`);

  // A dirty model (an edit in flight elsewhere) is not yet on disk: no refresh.
  const before = located.length;
  pageState = { ...settled(), dirty: true };
  await render({ selectionKey: THIRD });
  check('a dirty model is not read from disk', located.length === before, `${located.length - before} extra locates`);
  pageState = settled();

  // ── Picking it again from the canvas ─────────────────────────────────────
  await render({ selectionKey: BARE });
  await render({ selectionKey: THIRD });
  check('selecting again turns the dim back on', editor()?.classList.contains('cm-dimmed'), editor()?.className);

  // ── ⌘ over a component's tag ─────────────────────────────────────────────
  // jsdom lays nothing out, so the pointer cannot be put over a word; the
  // lookup that turns a position into a tag is checked directly, and the
  // link is set the way the hover would set it before the click is fired.
  {
    const st = view().state;
    const text = st.doc.toString();
    const at = (needle, offset = 1) => text.indexOf(needle) + offset;
    const open = componentTagAt(st, at('<Layout title'));
    check('the name in an opening tag is a component', open?.name === 'Layout', JSON.stringify(open));
    check('and its range is the name alone', open && text.slice(open.from, open.to) === 'Layout', open && text.slice(open.from, open.to));
    check('the closing tag too', componentTagAt(st, at('</Layout>', 3))?.name === 'Layout', JSON.stringify(componentTagAt(st, at('</Layout>', 3))));
    check('an element is not', componentTagAt(st, at('<section class', 2)) === null, JSON.stringify(componentTagAt(st, at('<section class', 2))));
    check('nor a word in an attribute', componentTagAt(st, at('title="Home"', 8)) === null, JSON.stringify(componentTagAt(st, at('title="Home"', 8))));
    check('nor text', componentTagAt(st, at('Write to us', 2)) === null);
    check("nor the import's own name", componentTagAt(st, at('import Layout', 8)) === null, JSON.stringify(componentTagAt(st, at('import Layout', 8))));

    await act(async () => { view().dispatch({ effects: setCmdLink.of(open) }) });
    const link = host.querySelector('.cm-cmd-link');
    check('the ⌘-hovered name is underlined as a link', link?.textContent === 'Layout', link?.textContent);
    // A plain click on it is a plain click.
    await act(async () => { link.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })) });
    check('a click without the modifier opens nothing', opened.length === 0, opened.join(','));
    await act(async () => { view().dispatch({ effects: setCmdLink.of(open) }) });
    await act(async () => {
      host.querySelector('.cm-cmd-link').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, metaKey: true, ctrlKey: true }));
    });
    check('a ⌘-click hands the component to the app', opened.join(',') === 'Layout', opened.join(','));
    check('and the underline goes with it', !host.querySelector('.cm-cmd-link'));
  }

  // ── Nothing selected, file still open ────────────────────────────────────
  await render({ selectionKey: BARE });
  check('clearing the selection keeps the file open', !!editor() && !empty());
  check('with no lines marked', focusLines().length === 0, focusLines().join(' | '));
  check('no dim', !editor()?.classList.contains('cm-dimmed'));
  check('and no line badge', !host.querySelector('.code-panel-lines'));

  // ── Another file, nothing selected in it ─────────────────────────────────
  await render({ selectionKey: 'src/pages/about.astro#' });
  check('a different file with nothing selected shows the placeholder', empty() === 'Select an element on the canvas' && !editor(), empty());

  // ── An earlier version on the canvas ─────────────────────────────────────
  await render({ selectionKey: THIRD, locked: true });
  check('a commit preview explains why there is no code to edit', /earlier version/.test(empty() || ''), empty());
  await render({ selectionKey: THIRD, locked: false });
  check('and the file is back once the preview ends', !!editor() && focusLines().length === 3, focusLines().join(' | '));

  // ── Leaving the panel mid-edit ───────────────────────────────────────────
  await act(async () => {
    view().dispatch({ changes: { from: 0, insert: '<!-- again -->\n' } });
  });
  const writesBefore = writes.length;
  await act(async () => { root.unmount() });
  await wait(50);
  check('unmounting with typing pending writes it now rather than never', writes.length === writesBefore + 1 && writes[writes.length - 1].text.startsWith('<!-- again -->'), `${writes.length - writesBefore} writes`);
  check('and nothing complained along the way', toasts.length === 0, toasts.join(' | '));

  if (failures.length) {
    console.error(`code-panel: ${failures.length} of ${checked} checks failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`code-panel: ${checked} checks passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
