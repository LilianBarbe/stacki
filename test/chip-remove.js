// Taking a class off the element from its chip in the well.
//
//   node test/chip-remove.js
//
// The well reads as the element's classes, but a class could only be removed
// somewhere else — the Settings panel's class field. Now a chip that is one
// class written on this element carries a ×. Only that kind of chip: a class a
// component put there (green) is not on this element to take off, a combo or a
// state names more than one thing, a tag is nothing the element carries.

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
  const bundlePath = path.join(buildDir, 'chip-remove.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export { SelectorPicker } from './EmbedEditor'`,
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
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.ResizeObserver = dom.window.ResizeObserver;
  global.MutationObserver = dom.window.MutationObserver;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

  const { SelectorPicker } = require(bundlePath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react');

  const reactRoot = createRoot(document.getElementById('root'));
  const removed = [];
  const selected = [];
  // The picker attaches `removable` from the element's authored classes; here
  // the chips arrive already told, the way the picker hands them on.
  const selectors = [
    { key: 'c', text: '.heading-style-display', role: 'composed' },
    { key: 'a', text: '.margin-bottom-7', role: 'added', removable: 'margin-bottom-7' },
    { key: 's', text: '.margin-bottom-7:hover', role: 'added' },
    { key: 'p', text: '.just-typed', role: 'added', pending: true, removable: 'just-typed' },
  ];
  const render = (props) =>
    act(async () => {
      reactRoot.render(
        React.createElement(SelectorPicker, {
          selectors,
          suggestions: [],
          activeSelector: '.margin-bottom-7',
          activePicked: true,
          busy: false,
          loading: false,
          onSelect: (text) => selected.push(text),
          onDeselect: () => selected.push(null),
          onAdd: () => {},
          onRemove: (name) => removed.push(name),
          ...props,
        })
      );
    });
  await render();

  const wrapFor = (text) =>
    [...document.querySelectorAll('.embed-editor_selector-chip-wrap')].find(
      (el) => el.querySelector('.embed-editor_selector-chip')?.textContent === text
    );
  const removeFor = (text) => wrapFor(text)?.querySelector('.embed-editor_selector-remove');

  check('the class written on the element has a ×', !!removeFor('.margin-bottom-7'), wrapFor('.margin-bottom-7')?.innerHTML);
  check('and the chip is marked so the × has room', wrapFor('.margin-bottom-7')?.classList.contains('is-removable'));
  check('the × says what it does', /Remove \.margin-bottom-7 from this element/.test(removeFor('.margin-bottom-7')?.title || ''), removeFor('.margin-bottom-7')?.title);
  check('the class the component composes with has none', !removeFor('.heading-style-display'), wrapFor('.heading-style-display')?.innerHTML);
  check('a state on the class has none', !removeFor('.margin-bottom-7:hover'));
  check('a class typed a moment ago (pending) can be taken back', !!removeFor('.just-typed'));
  check('the chip itself still reads as the selector', wrapFor('.margin-bottom-7')?.querySelector('.embed-editor_selector-chip')?.textContent === '.margin-bottom-7');

  await act(async () => { removeFor('.margin-bottom-7').click(); });
  check('clicking the × removes that class', removed.length === 1 && removed[0] === 'margin-bottom-7', JSON.stringify(removed));
  check('and does not also select or deselect the chip', selected.length === 0, JSON.stringify(selected));

  await act(async () => { wrapFor('.heading-style-display').querySelector('.embed-editor_selector-chip').click(); });
  check('clicking the chip still selects it', selected[selected.length - 1] === '.heading-style-display', JSON.stringify(selected));

  // Without a handler nothing can be removed, so nothing offers to be.
  await render({ onRemove: undefined });
  check('with no way to remove, no chip carries a ×', !document.querySelector('.embed-editor_selector-remove'));

  // While the panel is busy the × is disabled along with the chips.
  await render({ busy: true });
  check('a busy panel disables the ×', removeFor('.margin-bottom-7')?.disabled === true);

  if (failures.length) {
    console.error(`chip-remove: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`chip-remove: ${checked} passed  [a class comes off the element from its chip]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
