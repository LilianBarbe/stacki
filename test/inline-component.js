// Giving a component back to the page.
//
//   node test/inline-component.js
//
// Making a component out of a block moves markup and rewrites nothing, so it
// is short and it always works. Coming back is the other shape entirely: every
// `{title}` has to become what the instance passed, `<slot />` has to become
// what it wrapped, and the component's imports have to be re-aimed at the
// page's folder. Each is a place to be quietly wrong, and quietly wrong here
// means leaving somebody's page not rendering.
//
// So most of what is checked below is the refusing. A refusal costs a click; a
// wrong inline costs a page, and the person who has to notice it is the one
// who trusted the button.
//
// The accepting half is worth as much for one reason: it makes the pair
// reversible. A component this app made — imports, one destructure, nothing
// else — is exactly the shape this can undo.

const path = require('path');
const { inlineComponent } = require('../electron/inlineComponent.js');
const { serializeNodes } = require('../electron/astroParser.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

const inline = (componentSource, instance, opts = {}) =>
  inlineComponent({
    componentSource,
    componentPath: opts.componentPath || '/p/src/components/Card.astro',
    pagePath: opts.pagePath || '/p/src/pages/index.astro',
    instance: instance || { props: {}, children: [] },
  });

const markupOf = (result) => (result.ok ? serializeNodes(result.nodes).trim() : null);

// --- the pair is reversible ---------------------------------------------------
{
  const source = `---
const { title, href } = Astro.props;
---
<a href={href} class="card">
  <h2>{title}</h2>
  <slot />
</a>
`;
  const out = inline(source, {
    props: { title: { type: 'string', value: 'Bonjour' }, href: { type: 'string', value: '/a' } },
    children: [{ kind: 'text', value: 'inside' }],
  });
  check('a component this app could have made comes back', out.ok, out.reason);
  const markup = markupOf(out);
  check('a prop standing in the markup becomes its value', /<h2>Bonjour<\/h2>/.test(markup || ''), markup);
  check('a prop in an attribute becomes a plain attribute', /href="\/a"/.test(markup || ''), markup);
  check('the attribute that was already plain is left alone', /class="card"/.test(markup || ''), markup);
  check('and the slot becomes what the instance wrapped', /inside/.test(markup || ''), markup);
  check('nothing of the component tag survives', !/<Card/.test(markup || ''), markup);
}

// --- a prop the instance leaves out falls back to the default -----------------
{
  const source = `---
const { title = 'Untitled', count = 3, open = false } = Astro.props;
---
<h2 data-count={count} data-open={open}>{title}</h2>
`;
  const out = inline(source, { props: {}, children: [] });
  check('defaults stand in for what was not passed', out.ok, out.reason);
  const markup = markupOf(out);
  check('a string default arrives as text', /<h2[^>]*>Untitled<\/h2>/.test(markup || ''), markup);
  check('a number default stays an expression', /data-count=\{3\}/.test(markup || ''), markup);
  check('and so does a boolean', /data-open=\{false\}/.test(markup || ''), markup);
}

// --- an expression passed in reaches page scope, which is where it belongs ----
{
  const out = inline(
    `---
const { title } = Astro.props;
---
<h2>{title}</h2>
`,
    { props: { title: { type: 'expr', value: 'post.title' } }, children: [] }
  );
  check('an expression the page wrote stays an expression', out.ok, out.reason);
  check('and reads from the page it now lives in', /\{post\.title\}/.test(markupOf(out) || ''), markupOf(out));
}

// --- the refusals --------------------------------------------------------------
{
  const computed = inline(
    `---
const { title } = Astro.props;
const year = new Date().getFullYear();
---
<h2>{title} {year}</h2>
`,
    { props: { title: { type: 'string', value: 'Hi' } }, children: [] }
  );
  check('a component that computes something is refused', !computed.ok);
  check('and says the frontmatter is why', /frontmatter/.test(computed.reason || ''), computed.reason);

  const inExpression = inline(
    `---
const { title } = Astro.props;
---
<h2>{title.toUpperCase()}</h2>
`,
    { props: { title: { type: 'string', value: 'Hi' } }, children: [] }
  );
  check('a prop caught in an expression is refused', !inExpression.ok);
  check('and the prop is named', /title/.test(inExpression.reason || ''), inExpression.reason);

  const named = inline(
    `---
const { } = Astro.props;
---
<div><slot name="header" /></div>
`,
    { props: {}, children: [] }
  );
  check('a named slot is refused', !named.ok);
  check('and says so', /named slot/.test(named.reason || ''), named.reason);

  const missing = inline(
    `---
const { title } = Astro.props;
---
<h2>{title}</h2>
`,
    { props: {}, children: [] }
  );
  check('a prop with no value and no default is refused', !missing.ok);
  check('rather than rendering the page empty there', /title/.test(missing.reason || ''), missing.reason);

  const nowhere = inline(
    `---
const { } = Astro.props;
---
<div>nothing to fill</div>
`,
    { props: {}, children: [{ kind: 'text', value: 'orphan' }] }
  );
  check('content with no slot to hold it is refused', !nowhere.ok);
  check('instead of being dropped on the floor', /slot/.test(nowhere.reason || ''), nowhere.reason);
}

// --- what the component was leaning on comes with it --------------------------
{
  const out = inline(
    `---
import Button from './Button.astro';
import { formatDate } from '../lib/date.js';
import confetti from 'canvas-confetti';
---
<div><Button /></div>
`,
    { props: {}, children: [] },
    { componentPath: '/p/src/components/Card.astro', pagePath: '/p/src/pages/blog/post.astro' }
  );
  check('a component with imports comes back', out.ok, out.reason);
  const by = Object.fromEntries((out.imports || []).map((i) => [i.name, i.path]));
  // ./Button.astro read from src/components, written from src/pages/blog.
  check(
    'a relative import is re-aimed at the page that now holds it',
    by.Button === '../../components/Button.astro',
    by.Button
  );
  check(
    'and so is one that pointed outside the folder',
    by.formatDate === '../../lib/date.js',
    by.formatDate
  );
  check('a bare package means the same everywhere and is untouched', by.confetti === 'canvas-confetti', by.confetti);
}

// --- an empty instance leaves the component's own fallback in the slot --------
{
  const out = inline(
    `---
const { } = Astro.props;
---
<div><slot>fallback</slot></div>
`,
    { props: {}, children: [] }
  );
  check('a slot nobody filled keeps what the component put in it', out.ok, out.reason);
  check('which is its fallback', /fallback/.test(markupOf(out) || ''), markupOf(out));
}

// --- and the wiring that puts it within reach ---------------------------------
// The decision above is worth nothing if no one can ask for it, and the four
// files it travels through are each easy to leave half-done.
{
  const fs = require('fs');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  const main = read('electron', 'main.js');
  check(
    'the main process answers the request',
    /ipcMain\.handle\('component:inline'/.test(main),
    'no handler for component:inline'
  );
  check(
    'exactly once — Electron throws on a second handler for a channel',
    main.split("ipcMain.handle('component:inline'").length - 1 === 1
  );
  check('and it decides rather than writes', !/writeFileSync/.test(main.slice(main.indexOf("ipcMain.handle('component:inline'"), main.indexOf("ipcMain.handle('component:usage'"))), 'the handler writes to the project itself');

  check("the bridge carries it", /inlineComponent: invoke\('component:inline'\)/.test(read('electron', 'preload.js')));

  const app = read('src', 'App.jsx');
  check('the page splices in what comes back', /found\.list\.splice\(found\.index, 1, \.\.\.result\.nodes\)/.test(app));
  check('a refusal is said out loud', /can't be given back/.test(app), 'a refusal that says nothing reads as a broken button');
  check('and the handler reaches the panel', /onGiveComponentBack=\{giveComponentBack\}/.test(app));

  const panel = read('src', 'panels', 'StructurePanel.jsx');
  check('the menu offers it', /action="giveBack"/.test(panel));
  check(
    'only on a component, which is the only thing that stands for markup elsewhere',
    /\{isComponent && <Item action="giveBack"/.test(panel),
    'the item is offered on every node'
  );
  check('and the menu is told what it is looking at', /isComponent=\{ctxMenu\.kind === 'component'\}/.test(panel));
}

if (failures.length) {
  console.error(`\ninline-component: ${failures.length} failed, ${checked - failures.length} passed\n`);
  console.error(failures.join('\n') + '\n');
  process.exit(1);
}
console.log(`inline-component: ${checked} passed`);
