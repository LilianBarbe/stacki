// The CSS Code section's text: out of the stylesheet, and back in.
//
//   node test/css-code-section.js
//
// The section shows one selector's rules — base, each @media, a nested one —
// as a single piece of CSS, and writes what is typed there back into the file.
// The write is the part that can quietly go wrong in ways the panel would then
// show as correct: a rule replaced by a copy at the end of the file, a @media
// left empty behind a removed rule, a value the user did not touch reflowed,
// a selector renamed by dropping the rule and adding another. So the round
// trip is checked against the file's bytes, not the panel's reading of them.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};
const same = (what, got, want) =>
  check(what, got === want, `got:\n${String(got).replace(/^/gm, '      ')}\n    want:\n${String(want).replace(/^/gm, '      ')}`);

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const entry = path.join(buildDir, 'css-code-section.entry.ts');
  fs.writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(__dirname, '..', 'src', 'style-panel', 'lib', 'css-code-sync.ts'))}`,
      `export { collectRules, parseRegion } from ${JSON.stringify(path.join(__dirname, '..', 'src', 'style-panel', 'lib', 'css.ts'))}`,
    ].join('\n'),
  );
  const bundlePath = path.join(buildDir, 'css-code-section.bundle.js');
  await esbuild.build({
    entryPoints: [entry],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const lib = require(bundlePath);

  // A stylesheet as the panel holds it: a region with a live root, and the
  // rules walked out of it.
  const sheet = (css) => {
    const region = { start: 0, end: css.length, css, root: null };
    lib.parseRegion(region);
    const rules = lib.collectRules(region, {
      embedKey: 'k', embedLabel: 'global.css', fromComponent: false, componentName: null,
      regionIndex: 0, idSeed: 'k', order: { n: 0 },
    });
    return { region, rules, text: () => region.root.toString() };
  };
  const leavesFor = (s, selector) =>
    lib.collectCssCodeLeaves(s.rules.filter((r) => lib.ruleMatchesSelector(r, selector)));
  const apply = (s, selector, text) => lib.applyCssCode(s.region.root, leavesFor(s, selector), text);

  const source = [
    '.hero { padding: 1rem }',
    '.card{color:red;margin:0}',
    '.card:hover { color: blue }',
    '@media (width >= 64rem) {',
    '  .hero { padding: 2rem }',
    '  .card { padding: 2rem; }',
    '}',
    '',
  ].join('\n');

  // ── Rendering ──

  {
    const s = sheet(source);
    same('base and @media rules render together, formatted',
      lib.renderCssCode(leavesFor(s, '.card')),
      '.card {\n  color: red;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n');
    same(':hover is its own selector, not part of .card',
      lib.renderCssCode(leavesFor(s, '.card:hover')),
      '.card:hover {\n  color: blue;\n}\n');
    same('a selector without a rule renders nothing', lib.renderCssCode(leavesFor(s, '.none')), '\n');
  }

  {
    const s = sheet('.card { color: red; .title { font-weight: bold } }\n');
    same('a nested rule shows under its parent',
      lib.renderCssCode(leavesFor(s, '.card .title')),
      '.card {\n  .title {\n    font-weight: bold;\n  }\n}\n');
    same('a parent with its own declarations shows whole, nested rule included',
      lib.renderCssCode(leavesFor(s, '.card')),
      '.card {\n  color: red;\n\n  .title {\n    font-weight: bold;\n  }\n}\n');
  }

  {
    const s = sheet('.a, .b { color: red }\n');
    same('a grouped rule shows as the group', lib.renderCssCode(leavesFor(s, '.a')), '.a, .b {\n  color: red;\n}\n');
  }

  // ── Signatures ──

  same('layout does not change what the text says',
    lib.cssCodeSignature('.card{color:red}'), lib.cssCodeSignature('.card {\n  color: red;\n}\n'));
  same('order of blocks does not either',
    lib.cssCodeSignature('@media (a) { .card { x: 1 } } .card { y: 2 }'),
    lib.cssCodeSignature('.card { y: 2 } @media (a) { .card { x: 1 } }'));
  check('a changed value does',
    lib.cssCodeSignature('.card { color: red }') !== lib.cssCodeSignature('.card { color: blue }'));
  check('a rule moved into a @media does',
    lib.cssCodeSignature('.card { color: red }') !== lib.cssCodeSignature('@media (a) { .card { color: red } }'));
  same('text that does not parse has no signature', lib.cssCodeSignature('.card { color: '), null);

  // ── Writing back ──

  {
    const s = sheet(source);
    const res = apply(s, '.card', '.card {\n  color: green;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n');
    check('a changed value applies', res.ok && res.changed, JSON.stringify(res));
    same('only that rule changes, laid out afresh; the rest of the file keeps its bytes',
      s.text(),
      source.replace('.card{color:red;margin:0}', '.card {\n  color: green;\n  margin: 0;\n}'));
  }

  {
    const s = sheet(source);
    const res = apply(s, '.card', '.card {\n  color: red;\n  margin: 0;\n}\n');
    check('dropping the @media rule from the text applies', res.ok && res.changed);
    same('the rule goes, and the @media keeps its other rule',
      s.text(),
      source.replace('  .card { padding: 2rem; }\n', ''));
  }

  {
    const s = sheet('.card { color: red }\n@media (a) {\n  .card { x: 1 }\n}\n');
    apply(s, '.card', '.card {\n  color: red;\n}\n');
    same('a @media emptied by the removal goes with it', s.text(), '.card { color: red }\n');
  }

  {
    const s = sheet(source);
    apply(s, '.card', '.card {\n  color: red;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n\n@media (width < 40rem) {\n  .card {\n    padding: 0;\n  }\n}\n');
    same('a new @media block is created at the end, after a blank line',
      s.text(),
      `${source}\n@media (width < 40rem) {\n  .card {\n    padding: 0;\n  }\n}\n`);
  }

  {
    const s = sheet(source);
    apply(s, '.card', '.card {\n  color: red;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n  .card {\n    gap: 1rem;\n  }\n}\n');
    same('a rule added inside an existing @media lands in that block',
      s.text(),
      source.replace('  .card { padding: 2rem; }\n', '  .card { padding: 2rem; }\n  .card {\n    gap: 1rem;\n  }\n'));
  }

  {
    const s = sheet(source);
    const res = apply(s, '.card', '.card2 {\n  color: red;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n');
    check('renaming the selector applies', res.ok && res.changed);
    same('the renamed rule stays where it was', s.text(), source.replace('.card{color:red;margin:0}', '.card2 {\n  color: red;\n  margin: 0;\n}'));
  }

  {
    const s = sheet(source);
    const res = apply(s, '.card', lib.renderCssCode(leavesFor(s, '.card')));
    check('writing the text back unchanged changes nothing', res.ok && !res.changed, JSON.stringify(res));
    same('and leaves the file as it was', s.text(), source);
  }

  {
    const s = sheet(source);
    const res = apply(s, '.card', '.card{color:red;margin:0}@media (width >= 64rem){.card{padding:2rem}}');
    check('nor does the same CSS laid out differently', res.ok && !res.changed, JSON.stringify(res));
  }

  {
    const s = sheet(source);
    const res = apply(s, '.new', lib.cssCodeSkeleton('.new'));
    check('the skeleton for a new selector writes nothing', res.ok && !res.changed, JSON.stringify(res));
    same('and the file is untouched', s.text(), source);
    const res2 = apply(s, '.new', '.new {\n  color: red;\n}\n');
    check('its first declaration creates the rule', res2.ok && res2.changed);
    same('at the end of the file', s.text(), `${source}\n.new {\n  color: red;\n}\n`);
  }

  {
    const s = sheet('.a {\n\tcolor: red;\n}\n');
    apply(s, '.new', '.new { color: red }');
    same('a new rule takes the file\'s own indent', s.text(), '.a {\n\tcolor: red;\n}\n\n.new {\n\tcolor: red;\n}\n');
  }

  {
    const s = sheet('');
    apply(s, '.new', '.new { color: red }');
    same('a rule in an empty stylesheet starts on its own line', s.text(), '\n.new {\n  color: red;\n}');
  }

  {
    const s = sheet(source);
    const res = apply(s, '.card', '.card { color: ');
    check('text that does not parse is refused', !res.ok && /[a-z]/i.test(res.error || ''), JSON.stringify(res));
    same('and the file is untouched', s.text(), source);
  }

  {
    const s = sheet('.card { color: red; .title { font-weight: bold } }\n');
    apply(s, '.card .title', '.card {\n  .title {\n    font-weight: 700;\n  }\n}\n');
    same('a nested rule is edited inside its parent', s.text(), '.card { color: red; .title {\n    font-weight: 700;\n  } }\n');
  }

  {
    const s = sheet('.card { color: red; .title { font-weight: bold } }\n');
    apply(s, '.card', '.card {\n  color: blue;\n\n  .title {\n    font-weight: bold;\n  }\n}\n');
    same('a parent edited whole keeps its nested rule', s.text(), '.card {\n  color: blue;\n\n  .title {\n    font-weight: bold;\n  }\n}\n');
  }

  {
    const s = sheet(source);
    apply(s, '.card', '.card {\n  color: red;\n  margin: 0;\n}\n\n@media (width >= 64rem) {\n  .card {\n    padding: 2rem;\n  }\n}\n\n.card::before {\n  content: "";\n}\n');
    check('a rule for another selector typed in the section is still written',
      s.text().includes('.card::before {\n  content: "";\n}'), s.text());
  }

  if (failures.length) {
    console.error(`css-code-section: ${failures.length} of ${checked} checks failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`css-code-section: ${checked} checks passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
