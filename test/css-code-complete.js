// Completing the project's variables in the CSS Code section.
//
//   node test/css-code-complete.js
//
// Typing `var(--sp` offers the variables whose names start that way and
// closes the call; typing `--sp` in a value offers the same and wraps the
// pick in `var()`; a `--x` at the start of a line is a custom property being
// declared, and gets nothing. Variables of the kind the property takes come
// first. What this guards is the shape of what is applied — a `)` doubled
// when one was already there, or a `var(` wrapped around a name that was
// typed inside one, would leave broken CSS behind every pick.

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
  const bundlePath = path.join(buildDir, 'css-code-complete.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { projectVariableCompletion, kindsFor } from './lib/css-completion'
        export { EditorState } from '@codemirror/state'
        export { CompletionContext } from '@codemirror/autocomplete'
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
  const { projectVariableCompletion, kindsFor, EditorState, CompletionContext } = require(bundlePath);

  const VARS = [
    { collection: 'tokens.css', group: ':root', name: 'brand', value: '#f04', binding: 'var(--brand)', type: 'Color' },
    { collection: 'tokens.css', group: ':root', name: 'space-4', value: '1rem', binding: 'var(--space-4)', type: 'Size' },
    { collection: 'tokens.css', group: ':root', name: 'space-8', value: '2rem', binding: 'var(--space-8)', type: 'Size' },
    { collection: 'tokens.css', group: ':root', name: 'sans', value: 'Inter, sans-serif', binding: 'var(--sans)', type: 'FontFamily' },
  ];
  const source = projectVariableCompletion(() => VARS);
  const empty = projectVariableCompletion(() => []);

  // Completion at `|` in the text.
  const at = (text, src = source, explicit = false) => {
    const pos = text.indexOf('|');
    const doc = text.slice(0, pos) + text.slice(pos + 1);
    const state = EditorState.create({ doc });
    return src(new CompletionContext(state, pos, explicit));
  };
  const labels = (res) => (res ? res.options.map((o) => o.label) : null);
  const option = (res, label) => res?.options.find((o) => o.label === label);

  // ── Inside var() ──

  {
    const res = at('.card {\n  padding: var(--sp|\n}');
    check('inside var(), the variables are offered', !!res, 'no result');
    check('from the start of the name, so the typed part filters', res && res.from === '.card {\n  padding: var('.length, res?.from);
    check('every variable is in the list', JSON.stringify(labels(res)) === JSON.stringify(['--brand', '--space-4', '--space-8', '--sans']), JSON.stringify(labels(res)));
    check('a pick closes the call', option(res, '--space-4')?.apply === '--space-4)', option(res, '--space-4')?.apply);
    check('sizes come first for padding', option(res, '--space-4')?.boost === 1 && option(res, '--brand')?.boost === 0,
      JSON.stringify(res?.options.map((o) => [o.label, o.boost])));
    check('the value rides along as the hint', option(res, '--space-4')?.detail === '1rem', option(res, '--space-4')?.detail);
  }

  {
    const res = at('.card { padding: var(--sp|) }');
    check('with the call already closed, a pick does not close it again', option(res, '--space-4')?.apply === '--space-4', option(res, '--space-4')?.apply);
  }

  {
    const res = at('.card { color: var(|');
    check('just after `var(` the list opens on everything', !!res && res.options.length === VARS.length && res.from === '.card { color: var('.length, JSON.stringify(res && [res.from, labels(res)]));
    check('and colours come first for color', option(res, '--brand')?.boost === 1 && option(res, '--sans')?.boost === 0);
  }

  {
    const res = at('.card { margin: var(--a) var(--s|');
    check('a second call on the line completes its own name', res && res.from === '.card { margin: var(--a) var('.length, res?.from);
  }

  // ── A bare name in a value ──

  {
    const res = at('.card {\n  font-family: --sa|;\n}');
    check('a bare name in a value is offered too', !!res, 'no result');
    check('from the dashes', res && res.from === '.card {\n  font-family: '.length, res?.from);
    check('and wrapped in var() when picked', option(res, '--sans')?.apply === 'var(--sans)', option(res, '--sans')?.apply);
    check('font stacks come first for font-family', option(res, '--sans')?.boost === 1 && option(res, '--brand')?.boost === 0);
  }

  // ── Where nothing is offered ──

  check('a custom property being declared is not a reference', at('.card {\n  --sp|') === null);
  check('nor is one at the root', at(':root {\n  --brand|: red;\n}') === null);
  check('a plain value gets nothing from this source', at('.card { padding: 1|') === null);
  check('nothing to offer before the variables have loaded', at('.card { padding: var(--sp|', empty) === null);

  // ── Kinds ──

  check('border-radius takes a size, not a colour', JSON.stringify(kindsFor('border-radius')) === JSON.stringify(['Size', 'Number']), JSON.stringify(kindsFor('border-radius')));
  check('border-color takes a colour', JSON.stringify(kindsFor('border-color')) === JSON.stringify(['Color']));
  check('background takes a colour', JSON.stringify(kindsFor('background')) === JSON.stringify(['Color']));
  check('an unknown property lifts nothing', kindsFor('content').length === 0);

  if (failures.length) {
    console.error(`css-code-complete: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-complete: ${checked} passed  [var() closed once, bare names wrapped, kinds lifted]`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
