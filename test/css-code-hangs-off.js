// What the CSS Code section shows for a class whose rules are all on its descendants.
//
//   node test/css-code-hangs-off.js
//
// `.heading-accent` had no rule of its own — only `.heading-accent strong`,
// `.heading-accent a`, `.heading-accent s` — so its section came up empty, and
// read as "this class does nothing". The rules a class exists FOR belong in
// its section, whether they style the element or something under it.

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
  const bundlePath = path.join(buildDir, 'css-code-hangs-off.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { ruleMatchesSelector, hangsOff, collectCssCodeLeaves, renderCssCode } from './lib/css-code-sync'
        export { collectRules } from './lib/css'
        export { default as postcss } from 'postcss'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'ts',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { ruleMatchesSelector, hangsOff, collectCssCodeLeaves, renderCssCode, collectRules, postcss } = require(bundlePath);
  const rulesOf = (css) => {
    const root = postcss.parse(css);
    return collectRules({ start: 0, end: css.length, css, root }, {
      embedKey: 'k', embedLabel: 'l', fromComponent: false, componentName: null, regionIndex: 0, idSeed: 'k', order: { n: 0 },
    });
  };

  check('a descendant rule hangs off the class', hangsOff('.heading-accent strong', '.heading-accent'));
  check('so does a child rule', hangsOff('.heading-accent > a', '.heading-accent'));
  check('and a sibling one', hangsOff('.heading-accent + p', '.heading-accent'));
  check('a longer class name does not', !hangsOff('.heading-accent-2 strong', '.heading-accent'));
  check('nor a combo on the class', !hangsOff('.heading-accent.is-on strong', '.heading-accent'));
  check('nor a state on it', !hangsOff('.heading-accent:hover a', '.heading-accent'));
  check('nor the class itself', !hangsOff('.heading-accent', '.heading-accent'));
  check('nor the class further along a chain', !hangsOff('.hero .heading-accent strong', '.heading-accent'));
  check('only a lone compound can be hung off', !hangsOff('.hero .heading-accent strong', '.hero .heading-accent'));

  const css = '.heading-accent strong { color: var(--heading-accent); }\n.heading-accent a { text-decoration: underline; }\n.color-faded { opacity: .6; }\n.heading-accent-2 { top: 0 }';
  const rules = rulesOf(css);
  const mine = rules.filter((r) => ruleMatchesSelector(r, '.heading-accent'));
  check('the section gathers the rules hung off the class', mine.map((r) => r.selectorText).join(' | ') === '.heading-accent strong | .heading-accent a', mine.map((r) => r.selectorText).join(' | '));
  const text = renderCssCode(collectCssCodeLeaves(mine));
  check('and shows them with their full selectors', /\.heading-accent strong \{/.test(text) && /\.heading-accent a \{/.test(text), text);
  check('a rule for the class itself still comes first when there is one', rulesOf('.a strong { x: 1 } .a { y: 2 }').filter((r) => ruleMatchesSelector(r, '.a')).length === 2);

  if (failures.length) {
    console.error(`css-code-hangs-off: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-hangs-off: ${checked} passed  [a class's descendant rules are its CSS too]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
