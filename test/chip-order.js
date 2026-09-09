// The order of the selector chips in the style panel's well.
//
//   node test/chip-order.js
//
// A chip's place in the well is its rule's place in the stylesheet: the reset at
// the top of the sheet is the first chip, the class written last is the last one.
// That is the cascade, so reading the well downwards tells you who overrides whom —
// and the chip nearest the bottom is the one whose value is on screen.
//
// The order used to be a grouping by KIND (tag → base class → combo chain → the
// element's other classes → data attributes → complex selectors), with source order
// only breaking ties. It read tidily and meant nothing: a reset landed wherever its
// class sat in `class="…"`, and a chip's neighbours said nothing about the cascade.
//
// Two things this locks down beyond plain ascending order: a rule inside `@media`
// keeps its real position (the model holds base and conditional rules in separate
// lists, so counting chips as they are collected would push every query rule to the
// end), and a selector styled in several places is dated by its FIRST rule.

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
  const bundlePath = path.join(buildDir, 'chip-order.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { parseRegion, collectRules } from './lib/css'
        export { computeRuleModel } from './lib/cascade'
        export { listMatchedSelectors } from './lib/resolved'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'ts',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });

  const { parseRegion, collectRules, computeRuleModel, listMatchedSelectors } = require(bundlePath);

  // One stylesheet, written the way a project grows: a reset, then the base class,
  // then a query override, then the utility someone added this morning.
  const css = `
    * { box-sizing: border-box }
    body { margin: 0 }
    .card { padding: 1rem }
    @media (max-width: 40em) {
      .card { padding: 0.5rem }
      .card:hover { padding: 0.75rem }
    }
    .card:hover { padding: 2rem }
    .u-mt-4 { margin-top: 1rem }
  `;

  const region = { start: 0, end: css.length, css, root: null, openTag: '<style>' };
  parseRegion(region);
  const ctx = {
    embedKey: 'e1',
    embedLabel: 'Styles',
    fromComponent: false,
    componentName: null,
    regionIndex: 0,
    idSeed: 'seed',
    order: { n: 0 },
  };
  const rules = collectRules(region, ctx);

  // The element is a `<body>`-descendant `.card.u-mt-4` — answer every selector from
  // the "DOM" so the tree walk never runs.
  const domMatched = new Map();
  for (const rule of rules) for (const sel of rule.selectors) domMatched.set(sel.text, true);
  const target = { rootKey: 'el', view: {}, domMatched };

  const model = await computeRuleModel(rules, target);
  const chips = listMatchedSelectors(model, ' native-only');
  const byOrder = [...chips].sort((a, b) => a.order - b.order).map((c) => c.text);

  // The bare `*` never gets a chip of its own (it matches everything, so it would sit
  // in every element's well saying nothing) — it still takes its place in the sheet,
  // which is why `body` starts at 1 rather than 0.
  check(
    'chips are dated by their rule, in the order the sheet was written',
    JSON.stringify(byOrder) === JSON.stringify(['body', '.card', '.card:hover', '.u-mt-4']),
    `got ${JSON.stringify(byOrder)}`,
  );

  const orderOf = (text) => chips.find((c) => c.text === text)?.order;

  check('the reset comes before the base class', orderOf('body') < orderOf('.card'), `body ${orderOf('body')} vs .card ${orderOf('.card')}`);
  check('the class added last comes last', orderOf('.u-mt-4') > orderOf('.card:hover'), `.u-mt-4 ${orderOf('.u-mt-4')} vs .card:hover ${orderOf('.card:hover')}`);

  // `.card:hover` is first written INSIDE the @media, before the plain `.card:hover`
  // below it, so that is the position its chip carries. Two ways to get this wrong:
  // rank the chips by the order they are collected in (base rules are walked before
  // conditional ones, so the query rule would come out last), or date the chip by the
  // last rule that writes it instead of the first.
  check(
    'a rule inside a query keeps its real place in the sheet',
    orderOf('.card:hover') === 4,
    `.card:hover ${orderOf('.card:hover')} (expected 4: * 0, body 1, .card 2, @media .card 3, @media .card:hover 4)`,
  );

  // Every chip has an order, or the well would fall back to the "no order" bucket
  // and pile those chips at the bottom in alphabetical order.
  check('every chip carries a document order', chips.every((c) => typeof c.order === 'number'), JSON.stringify(chips.map((c) => [c.text, c.order])));

  if (failures.length) {
    console.error(`chip-order: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`chip-order: ${checked} passed  [well order follows the stylesheet]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
