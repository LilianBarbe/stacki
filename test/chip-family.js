// A class swapped for its sibling from its chip.
//
//   node test/chip-family.js
//
// The Settings panel's class field has this: click `margin-bottom-2` and every
// `margin-bottom-*` in the project is offered, previewed on hover, kept on
// click. The well's chips are the same classes, so they get the same menu —
// on right-click, since a click already selects the chip. Only a chip whose
// class is written on this element can be swapped; a component's own class,
// a state or a combo has nothing on the element to swap.

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
  const bundlePath = path.join(buildDir, 'chip-family.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export { SelectorPicker } from './EmbedEditor'\nexport { setHost } from './lib/host'\nexport { setCanvasFrame } from '../canvasQuery.js'`,
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
  dom.window.Element.prototype.scrollIntoView = () => {};

  const { SelectorPicker, setHost, setCanvasFrame } = require(bundlePath);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react');
  setHost({ projectClasses: ['margin-bottom-2', 'margin-bottom-4', 'margin-bottom-8', 'padding-4', 'heading-style-display'], selectedId: 'n1', pathOf: () => '0.3' });
  // What the page is told. The preview lives here and nowhere else.
  const worn = [];
  setCanvasFrame({ postMessage: (m) => { if (m.type === 'avb:class-preview') worn.push(`${m.path}:${m.from}>${m.to}`); } });

  const reactRoot = createRoot(document.getElementById('root'));
  const replaced = [];
  let carried = 'margin-bottom-2';
  const render = () =>
    act(async () => {
      reactRoot.render(
        React.createElement(SelectorPicker, {
          selectors: [
            { key: 'c', text: '.heading-style-display', role: 'composed' },
            { key: `a:${carried}`, text: `.${carried}`, role: 'added', removable: carried },
            { key: 'p', text: '.padding-4', role: 'added', removable: 'padding-4' },
          ],
          suggestions: [],
          activeSelector: `.${carried}`,
          activePicked: true,
          busy: false,
          loading: false,
          onSelect: () => {},
          onDeselect: () => {},
          onAdd: () => {},
          onRemove: () => {},
          // The app swaps the class on the element; here the chip list follows.
          onReplace: (from, to) => { replaced.push(`${from}>${to}`); carried = to; void render(); },
        })
      );
    });
  await render();

  const chip = (text) => [...document.querySelectorAll('.embed-editor_selector-chip')].find((el) => el.textContent === text);
  const menu = () => document.querySelector('.embed-editor_chip-menu');
  const items = () => [...document.querySelectorAll('.embed-editor_chip-menu-item')];
  const rightClick = (el) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });

  await rightClick(chip('.margin-bottom-2'));
  check('right-clicking a class chip opens its family', !!menu(), document.body.innerHTML.slice(0, 300));
  check('every class of the family, in scale order', items().map((i) => i.textContent).join(' ') === 'margin-bottom-2 margin-bottom-4 margin-bottom-8', items().map((i) => i.textContent).join(' '));
  check('the one that is on marked as such', items()[0]?.classList.contains('is-original'));

  await act(async () => { items()[1].dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
  check('hovering one shows it on the page', worn.join() === '0.3:margin-bottom-2>margin-bottom-4', worn.join());
  check('and writes nothing', replaced.length === 0, replaced.join());
  check('the chip keeps the class that is on', !!chip('.margin-bottom-2') && !chip('.margin-bottom-4'));
  check('and the menu stays open', !!menu());
  await act(async () => { items()[2].dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
  check('the next hover swaps the preview, not the original', worn[1] === '0.3:margin-bottom-4>margin-bottom-8', worn.join());

  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  check('Escape takes the preview off the page', worn[2] === '0.3:margin-bottom-8>margin-bottom-2', worn.join());
  check('still without writing', replaced.length === 0, replaced.join());
  check('and closes the menu', !menu());

  worn.length = 0;
  await rightClick(chip('.margin-bottom-2'));
  await act(async () => { items()[2].dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
  await act(async () => { items()[2].click(); });
  check('clicking one writes it, original to chosen', replaced.join() === 'margin-bottom-2>margin-bottom-8' && carried === 'margin-bottom-8', replaced.join());
  check('and the page is left wearing it for the write to catch up', worn.join() === '0.3:margin-bottom-2>margin-bottom-8', worn.join());
  check('and closes the menu', !menu());

  // Hovering back to the class that is on and choosing it: nothing to write.
  worn.length = 0;
  await rightClick(chip('.margin-bottom-8'));
  await act(async () => { items()[0].dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })); });
  await act(async () => { items()[2].click(); });
  check('choosing the original again writes nothing', replaced.length === 1, replaced.join());
  check('and only takes the preview off', worn.join() === '0.3:margin-bottom-8>margin-bottom-2,0.3:margin-bottom-2>margin-bottom-8', worn.join());

  await rightClick(chip('.heading-style-display'));
  check('a class from inside the component offers no family', !menu());
  await rightClick(chip('.padding-4'));
  check('nor does a class with no siblings in the project', !menu());

  if (failures.length) {
    console.error(`chip-family: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`chip-family: ${checked} passed  [a class swapped for its sibling, from its chip]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
