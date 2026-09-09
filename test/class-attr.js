// Putting a typed class on the element.
//
//   node test/class-attr.js
//
// Typing `.hero` in the style panel writes a rule for `.hero` — and a rule for
// a class the element does not carry never applies, so the class has to land on
// the element as well. It didn't: the panel's `onAddClass` was wired to the
// assets panel, and the one element it would have reached wrote its classes as
// `class:list={[…]}`, which the model left alone without saying so.
//
// The second half is what is checked here, against the shapes real components
// use: a list, a list broken over lines, a template literal, a plain string,
// and an expression that means something only the code knows — that one is
// refused out loud rather than guessed at.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePage, serializePage } = require('../electron/astroParser.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

const expr = (value) => ({ type: 'expr', value });
const str = (value) => ({ type: 'string', value });

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundlePath = path.join(buildDir, 'class-attr.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'classAttr.js')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { withClass, hasClass, withoutClass, withReplacedClass, acceptsClass } = require(bundlePath);

  // --- a plain class ----------------------------------------------------------
  check('an element with no classes gets one', withClass({}, 'hero').value.value === 'hero');
  check('under the plain attribute', withClass({}, 'hero').key === 'class');
  check(
    'an element with classes keeps them',
    withClass({ class: str('card is-wide') }, 'hero').value.value === 'card is-wide hero'
  );
  check('a class it already has is not added twice', withClass({ class: str('card') }, 'card') === null);
  check('and is reported as already there', hasClass({ class: str('card') }, 'card'));

  // --- class:list -------------------------------------------------------------
  const oneLine = { 'class:list': expr('["card", isWide && "is-wide"]') };
  check(
    'a list on one line grows on that line',
    withClass(oneLine, 'hero').value.value === '["card", isWide && "is-wide", "hero"]',
    withClass(oneLine, 'hero').value.value
  );
  check('and stays a list', withClass(oneLine, 'hero').key === 'class:list');
  check(
    'a class already in the list is not added again',
    withClass(oneLine, 'card') === null
  );
  check('an empty list still takes one', withClass({ 'class:list': expr('[]') }, 'hero').value.value === '["hero"]');
  check(
    'a list that is not written as a list is wrapped in one',
    withClass({ 'class:list': expr('props.classes') }, 'hero').value.value === '[props.classes, "hero"]'
  );

  // The shape Lumos writes: one entry per line, trailing comma.
  const multi = {
    'class:list': expr(`[
        "section",
        padClass("top", paddingTop),
        className,
      ]`),
  };
  const grown = withClass(multi, 'hero').value.value;
  check('a list broken over lines gets its own line', /\n\s+"hero",\n/.test(grown), grown);
  check(
    'indented like the entries above it',
    grown.split('\n').find((l) => l.includes('"hero"')) === '        "hero",',
    JSON.stringify(grown.split('\n').find((l) => l.includes('"hero"')))
  );
  check('with the list still closed', grown.trim().endsWith(']'), grown);
  check('and everything that was in it still in it', /"section"[\s\S]*className/.test(grown), grown);

  // --- class as an expression -------------------------------------------------
  check(
    'a template literal grows by one word',
    withClass({ class: expr('`card ${size}`') }, 'hero').value.value === '`card ${size} hero`',
    withClass({ class: expr('`card ${size}`') }, 'hero').value.value
  );
  check(
    'a word already in it is not repeated',
    withClass({ class: expr('`card ${size}`') }, 'card') === null
  );
  check(
    'a hole is not read as a name',
    !hasClass({ class: expr('`card ${size}`') }, 'size')
  );
  check(
    'an expression nobody can read is refused',
    withClass({ class: expr('cx(base, extra)') }, 'hero') === null
  );
  check('a name with a space in it is refused', withClass({}, 'a b') === null);

  // --- the real thing ---------------------------------------------------------
  // Parse a component the way the app does, add the class, write it back: the
  // file has to come out as a file, with one line more than it went in.
  const source = `---
interface Props { class?: string }
const { class: className } = Astro.props;
---

<section
  class:list={[
    "section",
    className,
  ]}
>
  <slot />
</section>
`;
  const { editable, model } = parsePage(source);
  check('the component parses', editable && !!model);
  const section = model.nodes.find((n) => n.kind === 'element' && n.name === 'section');
  check('its classes are a list, not a string', !!section?.props?.['class:list'], JSON.stringify(section?.props));

  const edit = withClass(section.props, 'hero');
  section.props[edit.key] = edit.value;
  const written = serializePage(model, source);
  check('the file still has its frontmatter', written.startsWith('---\n'), written.slice(0, 40));
  check('the class landed in the list', /"hero"/.test(written), written);
  check(
    'inside class:list, not beside it',
    /class:list=\{\[[\s\S]*"hero"[\s\S]*\]\}/.test(written) && !/\sclass="/.test(written),
    written
  );
  check(
    'the rest of the file is the rest of the file',
    written.includes('const { class: className } = Astro.props;') &&
      written.includes('<slot />') &&
      /"section"[\s\S]*className[\s\S]*"hero"/.test(written),
    written
  );

  // Re-parsing what was written gives the class back — the round trip is what
  // the canvas re-renders from.
  const again = parsePage(written);
  const again0 = again.model.nodes.find((n) => n.kind === 'element' && n.name === 'section');
  check('and it reads back as a class the element has', hasClass(again0.props, 'hero'), JSON.stringify(again0.props));
  check('once', (written.match(/"hero"/g) || []).length === 1, written);

  // --- and taking one off again ------------------------------------------------
  // The × on a chip in the style panel's well. The class leaves every place it
  // was written, in the shape it was written in — and the attribute goes with
  // it when nothing is left, the way the Settings field's last tag does.
  const one = (props, name) => withoutClass(props, name);
  const value = (props, name) => one(props, name)?.[0]?.value;
  check('a word leaves a class string', value({ class: str('card hero wide') }, 'hero')?.value === 'card wide', JSON.stringify(value({ class: str('card hero wide') }, 'hero')));
  check('the last word takes the attribute with it', one({ class: str('hero') }, 'hero')?.[0]?.value === undefined && one({ class: str('hero') }, 'hero')?.[0]?.key === 'class');
  check('a class the element does not carry is nothing to remove', one({ class: str('card') }, 'hero') === null);
  check(
    'an entry leaves a list on one line',
    value(oneLine, 'card')?.value === '[isWide && "is-wide"]',
    value(oneLine, 'card')?.value
  );
  check(
    'from the end of it too',
    value({ 'class:list': expr('["card", "hero"]') }, 'hero')?.value === '["card"]',
    value({ 'class:list': expr('["card", "hero"]') }, 'hero')?.value
  );
  check('the only entry takes the list with it', one({ 'class:list': expr('["hero"]') }, 'hero')?.[0]?.value === undefined);
  const grownBack = withoutClass({ 'class:list': expr(grown) }, 'hero')?.[0]?.value?.value;
  check('a line of its own leaves with its line', grownBack === multi['class:list'].value, JSON.stringify(grownBack));
  check(
    'a word leaves a string inside a list',
    value({ 'class:list': expr('["card hero", x]') }, 'hero')?.value === '["card", x]',
    value({ 'class:list': expr('["card hero", x]') }, 'hero')?.value
  );
  check(
    'a class the element carries only sometimes is refused',
    one(oneLine, 'is-wide') === null,
    JSON.stringify(one(oneLine, 'is-wide'))
  );
  check(
    'a word leaves a template literal, holes and all',
    value({ class: expr('`card ${size} hero`') }, 'hero')?.value === '`card ${size}`',
    value({ class: expr('`card ${size} hero`') }, 'hero')?.value
  );
  check('an expression nobody can read is refused here too', one({ class: expr('cx("hero", extra)') }, 'hero') === null);
  const twice = one({ class: str('hero a'), 'class:list': expr('["hero", b]') }, 'hero');
  check('a class named in two places leaves both', twice?.length === 2 && twice[0].value.value === 'a' && twice[1].value.value === '[b]', JSON.stringify(twice));

  // --- and swapping one for its sibling -----------------------------------------
  // The family menu on a chip: `gap-2` for `gap-4`, in place, so the class keeps
  // its position and everything around it stays put.
  const swap = (props, from, to) => withReplacedClass(props, from, to);
  check('a word is swapped in place in a class string', swap({ class: str('a gap-2 b') }, 'gap-2', 'gap-4')?.[0]?.value?.value === 'a gap-4 b', JSON.stringify(swap({ class: str('a gap-2 b') }, 'gap-2', 'gap-4')));
  check('and in a list entry', swap({ 'class:list': expr('["card", "gap-2"]') }, 'gap-2', 'gap-4')?.[0]?.value?.value === '["card", "gap-4"]', JSON.stringify(swap({ 'class:list': expr('["card", "gap-2"]') }, 'gap-2', 'gap-4')));
  check('and inside a condition, since a rename changes no logic', swap({ 'class:list': expr('["card", wide && "gap-2"]') }, 'gap-2', 'gap-4')?.[0]?.value?.value === '["card", wide && "gap-4"]', JSON.stringify(swap({ 'class:list': expr('["card", wide && "gap-2"]') }, 'gap-2', 'gap-4')));
  check('and in a template literal, holes left alone', swap({ class: expr('`gap-2 ${size}`') }, 'gap-2', 'gap-4')?.[0]?.value?.value === '`gap-4 ${size}`', JSON.stringify(swap({ class: expr('`gap-2 ${size}`') }, 'gap-2', 'gap-4')));
  check('a class the element does not carry cannot be swapped', swap({ class: str('a') }, 'gap-2', 'gap-4') === null);
  check('swapping for a class already there just drops the first', swap({ class: str('gap-2 gap-4') }, 'gap-2', 'gap-4')?.[0]?.value?.value === 'gap-4', JSON.stringify(swap({ class: str('gap-2 gap-4') }, 'gap-2', 'gap-4')));
  check('a prefix is not a word', swap({ class: str('gap-20') }, 'gap-2', 'gap-4') === null);

  // --- whether the element takes a class at all --------------------------------
  // The Settings panel shows a Class field for an element always, and for a
  // component only when it takes one; the style panel's well follows the same
  // rule, so the two never disagree about what can be put on the selection.
  check('an element takes a class', acceptsClass({ kind: 'element', name: 'div', props: {} }, []));
  check('a dynamic tag does too', acceptsClass({ kind: 'component', name: 'Tag', dynamicTag: true, props: {} }, []));
  check('a component that declares none does not', !acceptsClass({ kind: 'component', name: 'Card', props: {} }, [{ name: 'title', type: 'string' }]));
  check('one with a class prop does', acceptsClass({ kind: 'component', name: 'Card', props: {} }, [{ name: 'class', type: 'string' }]));
  check('one already carrying a class does', acceptsClass({ kind: 'component', name: 'Card', props: { class: str('hero') } }, []));
  check('or a class:list', acceptsClass({ kind: 'component', name: 'Card', props: { 'class:list': expr('["hero"]') } }, []));
  check('nothing selected takes nothing', !acceptsClass(null, []));

  // --- the panel is wired to it ----------------------------------------------
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  check(
    'the style panel is the one given onAddClass',
    /<StylePanel[\s\S]{0,2000}?onAddClass=/.test(app),
    'onAddClass is on some other panel, so typing a class reaches nothing'
  );
  check('the app adds classes through this rule', /withClass\(node\.props, clean\)/.test(app));
  check(
    'and says so when it cannot',
    /refused[\s\S]{0,200}showToast/.test(app),
    'an element whose class is code fails silently again'
  );
  check(
    'the style panel is also given onRemoveClass',
    /<StylePanel[\s\S]{0,2000}?onRemoveClass=/.test(app),
    'the × on a chip reaches nothing'
  );
  check('the app removes classes through this rule', /withoutClass\(node\.props, clean\)/.test(app));
  check('and swaps them through this one', /withReplacedClass\(node\.props, a, b\)/.test(app) && /<StylePanel[\s\S]{0,2500}?onReplaceClass=/.test(app));
  check(
    'and tells the panel whether the selection takes a class at all',
    /<StylePanel[\s\S]{0,2000}?acceptsClass=\{selectedAcceptsClass\}/.test(app) && /nodeAcceptsClass\(selectedNode, selectedSchema\)/.test(app),
    'the well would offer a class to a component that ignores one'
  );

  if (failures.length) {
    console.error(`\nclass-attr: ${failures.length} failed, ${checked - failures.length} passed\n`);
    console.error(failures.join('\n') + '\n');
    process.exit(1);
  }
  console.log(`class-attr: ${checked} passed`);
})();
