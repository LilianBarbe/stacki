// The colour a selector chip wears in the style panel's well.
//
//   node test/chip-role.js
//
// Every chip used to be the same blue, so the well said "here are some selectors"
// and nothing else: a browser reset, the tag, the class the element is built from
// and a utility somebody added last week all looked alike. The colour now carries
// the one distinction that matters when you are about to edit one — what the
// selector IS to this element:
//
//   green  a class the element carries that nobody wrote on it — it came out of
//          the component (a variant, the component's own markup)
//   blue   a class written on this element, on top of that composition
//   grey   a selector that styles the element WITHOUT being on it: a tag, a
//          reset, an ancestor chain
//   dashed a global (`:focus-visible`, `body > *`) — matches nearly every element
//          on the page, so it gets no fill at all
//
// The element under test is the hero's first heading: a component instance whose
// variant renders `heading-style-display`, with `margin-bottom-7` written on the
// call site. The canvas reports both; only the second is in the source. That gap
// IS the green/blue distinction — the source alone cannot tell them apart.

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
  const bundlePath = path.join(buildDir, 'chip-role.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `export { chipRole, SelectorPicker } from './EmbedEditor'`,
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

  const { chipRole, SelectorPicker } = require(bundlePath);

  // What the canvas says the element carries, and what the call site actually wrote.
  const CLASSES = ['heading-style-display', 'margin-bottom-7'];
  const AUTHORED = ['margin-bottom-7'];
  const role = (text) => chipRole(text, CLASSES, AUTHORED);

  // --- what each selector is to the element ---------------------------------
  check('the class the component composes the heading with is green', role('.heading-style-display') === 'composed', role('.heading-style-display'));
  check('the utility written on the call site is blue', role('.margin-bottom-7') === 'added', role('.margin-bottom-7'));
  check('a bare tag styles it without being on it — grey', role('h1') === 'inherited', role('h1'));
  check('so does an ancestor chain', role('.hero_component h1') === 'inherited', role('.hero_component h1'));
  check('and a reset reaching it through a descendant combinator', role('body .heading-style-display') === 'inherited', role('body .heading-style-display'));
  check('a global gets no fill', role(':focus-visible') === 'global', role(':focus-visible'));
  check('including one written as a combinator', role('body > *') === 'global', role('body > *'));

  // A state or a pseudo-element doesn't change WHOSE the selector is: `.x:hover`
  // is the same class as `.x`, and colouring it differently would split one class
  // across two colours for no reason the element knows about.
  check('a state on the composed class stays green', role('.heading-style-display:hover') === 'composed', role('.heading-style-display:hover'));
  check('a pseudo-element on it too', role('.heading-style-display::before') === 'composed', role('.heading-style-display::before'));
  check('a state on the added class stays blue', role('.margin-bottom-7:hover') === 'added', role('.margin-bottom-7:hover'));

  // A combo mixing the two only exists because of the class somebody put on the
  // call site, so it belongs with what was added — not with the composition.
  check('a combo of a component class and an added one is blue', role('.heading-style-display.margin-bottom-7') === 'added', role('.heading-style-display.margin-bottom-7'));
  check('the tag written with the component class stays green', role('h1.heading-style-display') === 'composed', role('h1.heading-style-display'));

  // An attribute selector targets the element, but it isn't a class it carries.
  check('a data attribute is not a class the element carries', role('[data-theme]') === 'inherited', role('[data-theme]'));

  // An element with no classes at all: nothing can be composed or added, and the
  // tag selector that styles it must not come out looking like one of its classes.
  check('a heading with no classes has no green chip', chipRole('h1', [], []) === 'inherited', chipRole('h1', [], []));

  // A plain element on a page — every class it carries is one somebody wrote on it.
  // Nothing came out of a component, so nothing is green.
  const plain = (text) => chipRole(text, CLASSES, CLASSES);
  check('a plain element composes nothing — its classes are all blue', plain('.heading-style-display') === 'added' && plain('.margin-bottom-7') === 'added', `${plain('.heading-style-display')} / ${plain('.margin-bottom-7')}`);

  // A class typed into the well is missing from the source for a completely
  // different reason than a component's — it is not there because it was added a
  // second ago. Absent from BOTH lists, it must not be mistaken for a variant.
  check('a class typed into the well is not a component class', role('.margin-top-3') === 'added', role('.margin-top-3'));

  // --- the colour actually reaches the chip ---------------------------------
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react');

  const reactRoot = createRoot(document.getElementById('root'));
  const selectors = [
    { key: 'r', text: 'h1', role: 'inherited' },
    { key: 'c', text: '.heading-style-display', role: 'composed' },
    { key: 'a', text: '.margin-bottom-7', role: 'added' },
  ];
  // The grey chip is the active one because grey chips are folded away by default
  // (see selector-well.js) — the active one is the exception that stays on screen,
  // and it is the only way to see one here without driving the toggle.
  await act(async () => {
    reactRoot.render(
      React.createElement(SelectorPicker, {
        selectors,
        suggestions: [],
        activeSelector: 'h1',
        activePicked: true,
        busy: false,
        loading: false,
        onSelect: () => {},
        onDeselect: () => {},
        onAdd: () => {},
      })
    );
  });

  const chipFor = (text) =>
    [...document.querySelectorAll('.embed-editor_selector-chip')].find((el) => el.textContent === text);

  check('the green chip is marked green in the markup', chipFor('.heading-style-display')?.classList.contains('is-composed'), chipFor('.heading-style-display')?.className);
  check('the blue one blue', chipFor('.margin-bottom-7')?.classList.contains('is-added'), chipFor('.margin-bottom-7')?.className);
  check('the grey one grey', chipFor('h1')?.classList.contains('is-inherited'), chipFor('h1')?.className);

  // The colour is the whole message, and a colour nobody has been told is just
  // decoration — the hover title says it in words.
  check('hovering a chip says what its colour means', /inside the component/.test(chipFor('.heading-style-display')?.title || ''), chipFor('.heading-style-display')?.title);

  // A chip that arrives without a role (a pending one, a caller that hasn't been
  // updated) must look like the blue it has always been, not like a new category.
  await act(async () => {
    reactRoot.render(
      React.createElement(SelectorPicker, {
        selectors: [{ key: 'x', text: '.no-role' }],
        suggestions: [],
        activeSelector: '',
        activePicked: false,
        busy: false,
        loading: false,
        onSelect: () => {},
        onDeselect: () => {},
        onAdd: () => {},
      })
    );
  });
  check('a chip with no role falls back to blue', chipFor('.no-role')?.classList.contains('is-added'), chipFor('.no-role')?.className);

  if (failures.length) {
    console.error(`chip-role: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`chip-role: ${checked} passed  [what the selector is, what colour it wears]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
