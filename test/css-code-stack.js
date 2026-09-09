// The CSS Code section with nothing picked: the element's classes, as Webflow
// writes them.
//
//   node test/css-code-stack.js
//
// Click an element and no class is picked; the section then reads like
// Webflow's style preview for it: one block per rule of a class the element
// carries — the base class, its combo, the combo again under each `@media` —
// downwards in cascade order, the rule that wins last. Nothing that reaches
// the element without being one of its classes (a tag, a reset, an ancestor
// chain, a global) — those are the well's folded-away chips. A declaration a
// later rule beats is struck through.

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
    stdin: {
      contents: `
        export { stackedCssCode } from './lib/css-code-stack'
        export { parseRegion, collectRules } from './lib/css'
        export { computeRuleModel } from './lib/cascade'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'ts',
    },
    outfile: bundlePath, bundle: true, format: 'cjs', platform: 'node', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const { stackedCssCode, parseRegion, collectRules, computeRuleModel } = require(bundlePath);

  // The hero section of a Webflow build: a base class, a combo, the combo's
  // phone override — and everything else that reaches a <section>.
  const css = `
    * { box-sizing: border-box }
    section { display: block; padding-left: 1rem }
    .page-wrapper .hero_wrap { color: red }
    .hero_wrap { background-color: var(--_theme---background-secondary); padding-left: 2rem }
    .hero_wrap.is-aplat { padding-right: var(--site--side); padding-left: var(--site--side) }
    @media screen and (max-width: 767px) {
      .hero_wrap.is-aplat { padding-right: 0rem; padding-left: 0rem }
    }
    .hero_wrap:hover { color: blue }
    :focus-visible { outline: 2px solid }
  `;
  const region = { start: 0, end: css.length, css, root: null, openTag: '<style>' };
  parseRegion(region);
  const rules = collectRules(region, { embedKey: 'e', embedLabel: 'main.css', fromComponent: false, componentName: null, regionIndex: 0, idSeed: 's', order: { n: 0 } });
  const domMatched = new Map();
  for (const rule of rules) for (const sel of rule.selectors) domMatched.set(sel.text, true);
  const model = await computeRuleModel(rules, { rootKey: 'el', view: {}, domMatched });
  const classList = ['hero_wrap', 'is-aplat'];
  const { text, struck } = stackedCssCode(model, classList);

  check('exactly Webflow\'s preview: base, combo, then the combo\'s query',
    text === [
      '.hero_wrap {',
      '  background-color: var(--_theme---background-secondary);',
      '  padding-left: 2rem;',
      '}',
      '',
      '.hero_wrap.is-aplat {',
      '  padding-right: var(--site--side);',
      '  padding-left: var(--site--side);',
      '}',
      '',
      '@media screen and (max-width: 767px) {',
      '  .hero_wrap.is-aplat {',
      '    padding-right: 0rem;',
      '    padding-left: 0rem;',
      '  }',
      '}',
      '',
      '.hero_wrap:hover {',
      '  color: blue;',
      '}',
      '',
    ].join('\n'),
    JSON.stringify(text));
  check('no tag rule, no reset, no global', !/section \{|\* \{|:focus-visible/.test(text), text);
  check('no ancestor chain either, though it beats the base class', !text.includes('.page-wrapper'), text);
  const struckText = struck.map((r) => text.slice(r.from, r.to));
  check('the base padding-left the combo beats is struck', struckText.includes('padding-left: 2rem;'), JSON.stringify(struckText));
  check('the combo\'s own padding-left, which wins, is not', !struckText.includes('padding-left: var(--site--side);'), JSON.stringify(struckText));
  check('a query\'s values are not judged against the base', !struckText.some((t) => t.includes('0rem')), JSON.stringify(struckText));
  check('a struck range covers the declaration exactly, no indent', struck.every((r) => text[r.from] !== ' ' && text[r.to - 1] === ';'), JSON.stringify(struck));

  check('an element with no class rules has nothing to show', stackedCssCode(model, ['nothing']).text === '');

  // The well's toggles bring the folded-away rules in, and only then.
  const withInherited = stackedCssCode(model, classList, { inherited: true }).text;
  check('showing inherited styles brings the tag rule and the ancestor chain in', /^section \{/m.test(withInherited) && withInherited.includes('.page-wrapper .hero_wrap {'), withInherited);
  check('in cascade order: the tag before the class it loses to, the chain before the combo written after it', withInherited.indexOf('section {') < withInherited.indexOf('.hero_wrap {') && withInherited.indexOf('.hero_wrap {') < withInherited.indexOf('.page-wrapper .hero_wrap {') && withInherited.indexOf('.page-wrapper .hero_wrap {') < withInherited.indexOf('.hero_wrap.is-aplat {'), withInherited);
  check('but not the globals — `*` is one, as the well has it', !withInherited.includes(':focus-visible') && !/^\* \{/m.test(withInherited));
  const withGlobals = stackedCssCode(model, classList, { globals: true }).text;
  check('showing globals brings the reset and the global in, and nothing inherited', /^\* \{/m.test(withGlobals) && withGlobals.includes(':focus-visible {') && !withGlobals.includes('section {'), withGlobals);

  if (failures.length) {
    console.error(`css-code-stack: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-stack: ${checked} passed  [the element's classes, as Webflow writes them]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
