const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const outfile = path.join(__dirname, '../node_modules/.stacki-test/code-editor-lifecycle.bundle.js');
  await require('esbuild').build({
    stdin: { contents: `export { default as CodeEditor } from './src/ui/CodeEditor.jsx'; export { EditorView } from '@codemirror/view';`, resolveDir: path.join(__dirname, '..'), loader: 'jsx' },
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'], logLevel: 'silent',
  });
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  for (const name of ['window', 'Window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) {
    Object.defineProperty(global, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true });
  }
  global.getComputedStyle = dom.window.getComputedStyle;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const errors = [];
  dom.window.addEventListener('error', (event) => errors.push(event.error));
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { CodeEditor, EditorView } = require(outfile);
  const root = createRoot(document.getElementById('root'));
  const changes = [];
  const render = async (value, revealLine = 2) => {
    await React.act(async () => root.render(React.createElement(CodeEditor, {
      value, revealLine, language: 'javascript', onChange: (text) => changes.push(text),
    })));
  };
  try {
    await render('one\ntwo\nthree');
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    assert.equal(view.state.selection.main.head, 4, 'initial reveal goes to the requested line');
    await React.act(async () => view.dispatch({ selection: { anchor: view.state.doc.length }, changes: { from: view.state.doc.length, insert: '!' } }));
    assert.deepEqual(changes, ['one\ntwo\nthree!'], 'user edits emit exactly once');
    const caret = view.state.selection.main.head;
    await render('one\ntwo\nthree!');
    assert.equal(view.state.selection.main.head, caret, 'controlled typing does not jump back to the revealed line');
    await render('external\nupdated\nsource');
    assert.equal(view.state.doc.toString(), 'external\nupdated\nsource');
    assert.equal(changes.length, 1, 'external reloads and app undo do not echo a new edit');
    await render('external\nupdated\nsource', 3);
    assert.equal(view.state.selection.main.head, view.state.doc.line(3).from, 'a new reveal request still moves the caret');
    assert.deepEqual(errors, [], 'the editor reports no asynchronous errors');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
  console.log('code-editor-lifecycle: passed [user edits, external reloads, caret, reveal]');
})().catch((error) => { console.error(error); process.exitCode = 1; });
