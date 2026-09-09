// What a word typed into the selector well means.
//
//   node test/typed-class.js
//
// `my-div` is a valid selector — for an element called <my-div>. Typed into a
// class-centric tool it means the class, and taking it literally wrote
// `my-div { … }` into a stylesheet: a rule that styled nothing, no class on the
// element, and a chip dashed for good. Three of those turned up in one project.

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
  const bundlePath = path.join(buildDir, 'typed-class.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'style-panel', 'lib', 'typed-selector.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    logLevel: 'silent',
  });
  const { asTypedSelector, isHtmlTag } = require(bundlePath);

  check('a bare word is its class', asTypedSelector('my-div') === '.my-div', asTypedSelector('my-div'));
  check('whatever the spaces around it', asTypedSelector('  this-is-div ') === '.this-is-div', asTypedSelector('  this-is-div '));
  check('a class written as one stays as written', asTypedSelector('.my-div') === '.my-div');
  check('a tag stays a tag', asTypedSelector('div') === 'div' && asTypedSelector('section') === 'section');
  check('in any case', asTypedSelector('DIV') === 'DIV');
  check('document tags the insert list leaves out are still tags', asTypedSelector('html') === 'html' && asTypedSelector('body') === 'body' && asTypedSelector('svg') === 'svg');
  check('a state is a selector, taken as written', asTypedSelector('.card:hover') === '.card:hover');
  check('so is a chain', asTypedSelector('.hero h1') === '.hero h1');
  check('and an attribute', asTypedSelector('[data-theme]') === '[data-theme]');
  check('and a tag with a class', asTypedSelector('div.card') === 'div.card');
  check('a word with a digit in it is still a class', asTypedSelector('col-2') === '.col-2');
  check('a lone digit is not a class name', asTypedSelector('2') === '2');
  check('the tag test says what it knows', isHtmlTag('p') && isHtmlTag('Main') && !isHtmlTag('my-div'));

  if (failures.length) {
    console.error(`typed-class: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`typed-class: ${checked} passed  [a bare word in the well is a class]`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
