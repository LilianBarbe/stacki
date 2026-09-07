// Folding a folder shut in the Components panel.
//
//   node test/palette-folds.js
//
// The panel groups components by the folder they sit in, which is what makes a
// project of forty components readable — until the folder you are not working
// in is forty rows you scroll past. So a folder can be shut.
//
// Two things about it are not obvious from the markup.
//
// The fold is written to localStorage rather than kept in state, because this
// panel unmounts every time the left rail changes tab — and starting a drag
// switches to the Navigator on purpose, so the gesture the palette exists for
// is itself the one that would forget. A fold that does not survive that is a
// fold nobody would use twice.
//
// And a search reaches into a shut folder. A field that answers "no results"
// because the match is behind a fold is a field that lies, and the person
// searching is the one least able to know that is what happened.

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
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'https://stacki.test',
  });
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
  global.getComputedStyle = dom.window.getComputedStyle;
  global.localStorage = dom.window.localStorage;

  const React = require('react');
  const { createRoot } = require('react-dom/client');

  const bundle = path.join(buildDir, 'palette-folds.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export { default as PalettePanel } from './src/panels/PalettePanel.jsx'`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'js',
    },
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom'],
    logLevel: 'silent',
  });
  const { PalettePanel } = require(bundle);

  const COMPONENTS = [
    { path: '/p/src/components/Card.astro', name: 'Card', folder: '' },
    { path: '/p/src/components/Form/Fieldset.astro', name: 'Fieldset', folder: 'Form' },
    { path: '/p/src/components/Form/Input.astro', name: 'Input', folder: 'Form' },
    { path: '/p/src/components/Marketing/Hero.astro', name: 'Hero', folder: 'Marketing' },
  ];

  const panel = document.createElement('div');
  document.body.appendChild(panel);
  const tick = () => new Promise((r) => dom.window.setTimeout(r, 0));

  let root = createRoot(panel);
  const mount = async () => {
    root.render(React.createElement(PalettePanel, { components: COMPONENTS, onInsert: () => {} }));
    await tick();
  };
  const remount = async () => {
    root.unmount();
    root = createRoot(panel);
    await mount();
  };

  const folderButton = (name) =>
    [...panel.querySelectorAll('button.palette-folder')].find(
      (b) => b.querySelector('.palette-folder-name')?.textContent === name
    );
  const itemNames = () => [...panel.querySelectorAll('.palette-item .label')].map((l) => l.textContent.trim().split('\n')[0]);
  const shows = (name) => itemNames().some((t) => t.startsWith(name));
  const click = async (el) => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick();
  };

  await mount();

  // --- the header is the control ----------------------------------------------
  check('a folder gets a header', !!folderButton('Form'), [...panel.querySelectorAll('.palette-folder')].map((b) => b.textContent).join(' | '));
  check('the header is a button, not a label', folderButton('Form')?.tagName === 'BUTTON', folderButton('Form')?.tagName);
  check('components at the root get no header', !folderButton(''), 'the ungrouped run was given one');
  check('and everything is on show to begin with', shows('Fieldset') && shows('Input') && shows('Hero') && shows('Card'), itemNames().join(', '));
  check('the header counts what is inside', folderButton('Form')?.querySelector('.palette-folder-count')?.textContent === '2', folderButton('Form')?.querySelector('.palette-folder-count')?.textContent);
  check('and says it is open', folderButton('Form')?.getAttribute('aria-expanded') === 'true', folderButton('Form')?.getAttribute('aria-expanded'));

  // --- shutting one ------------------------------------------------------------
  await click(folderButton('Form'));
  check('shutting a folder takes its components away', !shows('Fieldset') && !shows('Input'), itemNames().join(', '));
  check('but leaves the folder itself', !!folderButton('Form'), 'the header went with them');
  check('which now says it is shut', folderButton('Form')?.getAttribute('aria-expanded') === 'false', folderButton('Form')?.getAttribute('aria-expanded'));
  check('the count is what a shut folder has left to say', folderButton('Form')?.querySelector('.palette-folder-count')?.textContent === '2');
  check('and no other folder is touched', shows('Hero') && shows('Card'), itemNames().join(', '));

  // --- and it holds across the unmount a drag causes ---------------------------
  await remount();
  check('the fold survives the panel being unmounted', !shows('Fieldset'), itemNames().join(', '));
  check('which is what starting a drag does', localStorage.getItem('stacki.palette.collapsed') === '["Form"]', localStorage.getItem('stacki.palette.collapsed'));

  // --- a search still reaches inside -------------------------------------------
  const input = panel.querySelector('input');
  const type = async (value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await tick();
  };
  await type('input');
  check('a search finds what a shut folder is holding', shows('Input'), itemNames().join(', '));
  check('and says so on the header', folderButton('Form')?.getAttribute('aria-expanded') === 'true', folderButton('Form')?.getAttribute('aria-expanded'));

  await type('');
  check('clearing the search shuts it again', !shows('Fieldset'), itemNames().join(', '));

  // --- opening it again --------------------------------------------------------
  await click(folderButton('Form'));
  check('opening it brings them back', shows('Fieldset') && shows('Input'), itemNames().join(', '));
  check('and nothing is left folded', localStorage.getItem('stacki.palette.collapsed') === '[]', localStorage.getItem('stacki.palette.collapsed'));

  if (failures.length) {
    console.error(`\npalette-folds: ${failures.length} failed, ${checked - failures.length} passed\n`);
    console.error(failures.join('\n') + '\n');
    process.exit(1);
  }
  console.log(`palette-folds: ${checked} passed`);
  process.exit(0);
})();
