// Authored box shorthands must reach the spacing labels through the real cascade.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundle = path.join(buildDir, 'spacing-shorthand.bundle.js');
  await require('esbuild').build({
    stdin: {
      contents: `
        export { parseRegion, collectRules } from './lib/css'
        export { computeRuleModel } from './lib/cascade'
        export { resolveStyle } from './lib/resolved'
        export { SpacingLabel } from './SpacingBox'
      `,
      resolveDir: path.join(__dirname, '..', 'src', 'style-panel'),
      loader: 'tsx',
    },
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
  });
  const { parseRegion, collectRules, computeRuleModel, resolveStyle, SpacingLabel } = require(bundle);
  const resolve = async (css, selector = '.card', context = '') => {
    const region = { start: 0, end: css.length, css, root: null, openTag: '<style>' };
    parseRegion(region);
    const rules = collectRules(region, {
      embedKey: 'sheet', embedLabel: 'Styles', fromComponent: false,
      componentName: null, regionIndex: 0, idSeed: 'spacing', order: { n: 0 },
    });
    const domMatched = new Map(rules.flatMap((r) => r.selectors.map((s) => [s.text, true])));
    const model = await computeRuleModel(rules, { rootKey: 'el', view: {}, domMatched });
    const resolved = resolveStyle(model, context, selector);
    assert.equal(region.root.toString(), css, 'reading spacing does not rewrite CSS');
    return resolved;
  };
  const sides = ['top', 'right', 'bottom', 'left'];
  const values = (r, box = 'padding') => sides.map((s) => r.props.get(`${box}-${s}`)?.winner.value);

  const original = await resolve('.card { padding: var(--space-3) }');
  assert.deepEqual(values(original), Array(4).fill('var(--space-3)'));
  assert.equal(original.props.get('padding').selectedValue.value, 'var(--space-3)');
  for (const side of sides) {
    const prop = original.props.get(`padding-${side}`);
    assert.equal(prop.source, 'selected');
    assert.equal(prop.winner.embedKey, 'sheet');
    assert.equal(prop.overridden, false);
  }

  for (const [input, expected] of [
    ['1rem', ['1rem', '1rem', '1rem', '1rem']],
    ['var(--space-3, 6px) calc(1rem + 2px)', ['var(--space-3, 6px)', 'calc(1rem + 2px)', 'var(--space-3, 6px)', 'calc(1rem + 2px)']],
    ['1px 2px 3px', ['1px', '2px', '3px', '2px']],
    ['1px 2px 3px 4px', ['1px', '2px', '3px', '4px']],
  ]) {
    assert.deepEqual(values(await resolve(`.card { padding: ${input} }`)), expected);
  }
  assert.deepEqual(values(await resolve('.card { margin: 0 auto }'), 'margin'), ['0', 'auto', '0', 'auto']);
  assert.deepEqual(values(await resolve('.card { padding: var(--space-3); padding-left: 2rem }')),
    ['var(--space-3)', 'var(--space-3)', 'var(--space-3)', '2rem']);
  assert.deepEqual(values(await resolve('.card { padding-left: 2rem; padding: var(--space-3) }')),
    Array(4).fill('var(--space-3)'));
  const important = await resolve('.card { padding: var(--space-3) !important; padding-left: 2rem }');
  assert.deepEqual(values(important), Array(4).fill('var(--space-3)'));
  assert.equal(important.props.get('padding-left').winner.important, true);
  assert.equal((await resolve('.card { padding-left: 2rem !important; padding: var(--space-3) }'))
    .props.get('padding-left').winner.value, '2rem');
  assert.equal((await resolve('.card { padding: 1rem !important; padding: 2rem !important }'))
    .props.get('padding-left').winner.value, '2rem');

  const overridden = await resolve('.card { padding: var(--space-3) } .card.special { padding-left: 4rem }');
  assert.equal(overridden.props.get('padding-left').winner.value, '4rem');
  assert.equal(overridden.props.get('padding-left').selectedValue.value, 'var(--space-3)');
  assert.equal(overridden.props.get('padding-left').overridden, true);
  const inherited = await resolve('.card { padding: var(--space-3) }', '.other');
  assert.equal(inherited.props.get('padding-top').source, 'other');
  const responsive = await resolve('.card { padding: var(--space-3) } @media (max-width: 600px) { .card { padding-left: 1rem } }', '.card', '@media (max-width: 600px)');
  assert.equal(responsive.props.get('padding-top').source, 'other');
  assert.equal(responsive.props.get('padding-left').source, 'selected');
  assert.equal(responsive.props.get('padding-left').winner.value, '1rem');

  // Render the real UI labels: the token name and selected/inherited state must
  // survive the full parse -> cascade -> display path, including variable styling.
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { JSDOM } = require('jsdom');
  const noop = () => {};
  const label = (resolved, side) => {
    const html = renderToStaticMarkup(React.createElement(SpacingLabel, {
      prop: `padding-${side}`, side, emptyLabel: '0', read: (p) => resolved.props.get(p),
      busy: false, clearProp: noop, onEdit: noop, setProp: noop, liveSetProp: noop,
      onLive: noop, onLiveEnd: noop, variableLabels: true,
      variables: [{ name: 'space-3', binding: 'var(--space-3)' }],
    }));
    return new JSDOM(html).window.document.querySelector('button');
  };
  for (const side of sides) {
    const button = label(original, side);
    assert.equal(button.textContent, 'space-3');
    assert.ok(button.classList.contains('is-variable'));
    assert.ok(button.classList.contains('is-selected'));
  }
  assert.ok(label(inherited, 'top').classList.contains('is-other'));
  assert.ok(label(overridden, 'left').classList.contains('is-overridden'));
  console.log('spacing-shorthand: cascade, variable labels and source preservation passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
