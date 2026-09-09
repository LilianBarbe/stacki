// The CSS Code section with nothing picked: every rule reaching the element.
//
//   node test/css-code-stack.js
//
// Click an element and no class is picked; what the section shows then is the
// sum — each rule that reaches the element, one under another, winners first,
// with the declarations that lose the cascade struck through, as DevTools
// draws it. Built from the resolved style, so it agrees with the fields.

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
  const bundlePath = path.join(buildDir, 'css-code-stack.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'style-panel', 'lib', 'css-code-stack.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { stackedCssCode } = require(bundlePath);

  // A heading carrying `.heading` (from a base sheet) and `.color-faded` (a
  // utility, written later), under a `h2` reset: three rules, and `color` set
  // by all three. The utility wins colour; the base wins the rest.
  const c = (ruleId, selectorText, value, specificity, order, winning, label, important = false) =>
    ({ ruleId, selectorText, value, specificity, order, winning, embedLabel: label, important, origin: 'embed', isSelected: false, complexOnly: false });
  const props = new Map([
    ['color', { prop: 'color', source: 'other', contributors: [
      c('r1', 'h2', 'black', [0, 0, 1], 1, false, 'base.css'),
      c('r2', '.heading', 'var(--text)', [0, 1, 0], 5, false, 'base.css'),
      c('r3', '.color-faded', 'var(--faded)', [0, 1, 0], 9, true, 'utilities.css'),
    ] }],
    ['font-size', { prop: 'font-size', source: 'other', contributors: [
      c('r1', 'h2', '1.5rem', [0, 0, 1], 1, false, 'base.css'),
      c('r2', '.heading', '2rem', [0, 1, 0], 5, true, 'base.css'),
    ] }],
    ['margin', { prop: 'margin', source: 'other', contributors: [
      c('r1', 'h2', '0', [0, 0, 1], 1, true, 'base.css', true),
    ] }],
  ]);
  const { text, struck } = stackedCssCode({ props, selectedRule: null, contexts: [''], states: [] });
  const lines = text.split('\n');

  check('one block per rule', (text.match(/\{/g) || []).length === 3, text);
  check('winners first: the utility that wins colour is on top', lines.indexOf('.color-faded {') < lines.indexOf('.heading {') && lines.indexOf('.heading {') < lines.indexOf('h2 {'), text);
  check('each block names its file', lines[0] === '/* utilities.css */', lines[0]);
  check('a block holds its own declarations', /\.heading \{\n  color: var\(--text\);\n  font-size: 2rem;\n\}/.test(text), text);
  check('!important is spelled', /margin: 0 !important;/.test(text), text);

  const struckText = struck.map((r) => text.slice(r.from, r.to));
  check('the losing colours are struck', struckText.includes('color: var(--text);') && struckText.includes('color: black;'), JSON.stringify(struckText));
  check('and the losing font-size', struckText.includes('font-size: 1.5rem;'), JSON.stringify(struckText));
  check('winners are not', !struckText.some((t) => /^color: var\(--faded\)|^font-size: 2rem|^margin: 0/.test(t)), JSON.stringify(struckText));
  check('a struck range covers the declaration exactly, no indent', struck.every((r) => text[r.from] !== ' ' && text[r.to - 1] === ';'), JSON.stringify(struck));

  check('nothing reaching the element is nothing to show', stackedCssCode({ props: new Map(), selectedRule: null, contexts: [], states: [] }).text === '');

  if (failures.length) {
    console.error(`css-code-stack: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-stack: ${checked} passed  [every rule reaching the element, losers struck]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
