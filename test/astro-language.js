// Astro in the editor: the frontmatter is TypeScript, the rest is HTML.
//
//   node test/astro-language.js
//
// The Code panel used to open an .astro file with the plain HTML parser,
// which knows nothing of the `---` fence and painted the code inside it as
// text. This checks, on a real parse, that the fence is TypeScript to the
// syntax tree (so it takes the editor's colours), that the markup below it
// is still HTML, and that the fence is found — or not — the way Astro reads
// it.

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
  const bundle = path.join(buildDir, 'astro-language.bundle.js');
  await esbuild.build({
    stdin: {
      contents:
        `export { astro, frontmatterRange } from './src/ui/astroLanguage.js';\n` +
        `export { extensionFor, languageFor } from './src/ui/Code.jsx';\n` +
        `export { EditorState } from '@codemirror/state';\n` +
        `export { html } from '@codemirror/lang-html';\n` +
        `export { ensureSyntaxTree } from '@codemirror/language';\n` +
        `export { highlightTree, classHighlighter } from '@lezer/highlight';\n`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'js',
    },
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const { astro, frontmatterRange, extensionFor, languageFor, EditorState, html, ensureSyntaxTree, highlightTree, classHighlighter } = require(bundle);

  // ── Finding the fence ────────────────────────────────────────────────────
  {
    const r = (t) => frontmatterRange(t);
    check('a file with no fence has no frontmatter', r('<div></div>\n') === null);
    check('a horizontal rule in markdown-ish text is not a fence', r('<p>x</p>\n---\n') === null);
    const t = '---\nconst a = 1;\n---\n<div />\n';
    check('the range is the code between the fences', JSON.stringify(r(t)) === JSON.stringify({ from: 4, to: 17 }), JSON.stringify(r(t)));
    check('leading blank lines are allowed before the opening fence', r('\n\n---\nx\n---\n')?.from === 6, JSON.stringify(r('\n\n---\nx\n---\n')));
    check('CRLF too', JSON.stringify(r('---\r\nx\r\n---\r\n')) === JSON.stringify({ from: 5, to: 8 }), JSON.stringify(r('---\r\nx\r\n---\r\n')));
    check('an empty frontmatter is an empty range', JSON.stringify(r('---\n---\n<a/>')) === JSON.stringify({ from: 4, to: 4 }), JSON.stringify(r('---\n---\n<a/>')));
    check('a --- inside a string on its own line is still the closing fence (as Astro reads it)', r('---\nconst s = `\n---\n`;\n---\n')?.to === 16, JSON.stringify(r('---\nconst s = `\n---\n`;\n---\n')));
    check('a fence still being typed runs to the end', r('---\nconst a')?.to === 11, JSON.stringify(r('---\nconst a')));
    check('an indented --- does not close it', r('---\na\n  ---\nb\n---\n')?.to === 14, JSON.stringify(r('---\na\n  ---\nb\n---\n')));
  }

  // ── The parse ────────────────────────────────────────────────────────────
  const DOC = [
    '---',
    "import Layout from '../layouts/Layout.astro';",
    'const items: Array<string> = ["a", "b"];',
    'const big = items.length > 1;',
    '---',
    '<Layout title="Home">',
    '  <h1 class="hero">Hello</h1>',
    '  <style>h1 { color: red; }</style>',
    '  <script>const n = 1;</script>',
    '</Layout>',
    '',
  ].join('\n');
  const state = EditorState.create({ doc: DOC, extensions: [astro()] });
  const tree = ensureSyntaxTree(state, DOC.length, 5000);
  const at = (needle, offset = 0) => DOC.indexOf(needle) + offset;
  const nameAt = (pos) => tree.resolveInner(pos, 1).name;
  const chain = (pos) => { const out = []; for (let n = tree.resolveInner(pos, 1); n; n = n.parent) out.push(n.name); return out.join(' < '); };

  check('the tree was fully parsed', !!tree && tree.length === DOC.length, tree && tree.length);
  check("'import' in the fence is a TypeScript keyword", nameAt(at('import')) === 'import', chain(at('import')));
  check('a string in the fence is a string', nameAt(at("'../layouts")) === 'String', chain(at("'../layouts")));
  check('a type annotation is a type, not a tag', /Type/.test(chain(at('Array<string>'))) && !/Element|Tag/.test(chain(at('Array<string>'))), chain(at('Array<string>')));
  check('a comparison is not the start of a tag', !/Element|Tag/.test(chain(at('> 1'))), chain(at('> 1')));
  check('a declaration is a declaration', /VariableDeclaration/.test(chain(at('const big'))), chain(at('const big')));
  check('the fences themselves are not code', !/Script|VariableDeclaration|Statement/.test(chain(0)), chain(0));
  check('the markup below is HTML', /Element/.test(chain(at('<Layout'))) && nameAt(at('<Layout')) === 'StartTag', chain(at('<Layout')));
  check('an attribute is an attribute', nameAt(at('title=')) === 'AttributeName', chain(at('title=')));
  check('and text is text', nameAt(at('Hello')) === 'Text', chain(at('Hello')));
  check('<style> is still CSS', /StyleSheet|RuleSet/.test(chain(at('color: red'))), chain(at('color: red')));
  check('<script> is still JavaScript', /VariableDeclaration/.test(chain(at('const n'))), chain(at('const n')));

  // ── The colours ──────────────────────────────────────────────────────────
  // What the highlighter hands out, by position: the keyword in the fence
  // must get a class at all, which is what "not white" means.
  const classes = new Map();
  highlightTree(tree, classHighlighter, (from, to, cls) => classes.set(from, { to, cls }));
  const classAt = (pos) => { for (const [from, { to, cls }] of classes) if (pos >= from && pos < to) return cls; return null; };
  check('the import keyword is highlighted as a keyword', /tok-keyword/.test(classAt(at('import')) || ''), classAt(at('import')));
  check('the string in the fence as a string', /tok-string/.test(classAt(at("'../layouts")) || ''), classAt(at("'../layouts")));
  // The markup's colours are whatever plain HTML gives them.
  const plain = EditorState.create({ doc: DOC, extensions: [html({ matchClosingTags: false })] });
  const plainClasses = new Map();
  highlightTree(ensureSyntaxTree(plain, DOC.length, 5000), classHighlighter, (from, to, cls) => plainClasses.set(from, { to, cls }));
  const plainAt = (pos) => { for (const [from, { to, cls }] of plainClasses) if (pos >= from && pos < to) return cls; return null; };
  check('a tag name below is coloured as HTML colours it', classAt(at('Layout title')) && classAt(at('Layout title')) === plainAt(at('Layout title')), `${classAt(at('Layout title'))} vs ${plainAt(at('Layout title'))}`);
  check('an attribute too', classAt(at('title=')) && classAt(at('title=')) === plainAt(at('title=')), `${classAt(at('title='))} vs ${plainAt(at('title='))}`);

  // ── The panel picks it for .astro ────────────────────────────────────────
  check('.astro is its own language to the Code panel', languageFor('src/pages/index.astro') === 'astro', languageFor('src/pages/index.astro'));
  check('.html stays html', languageFor('a.html') === 'html');
  check('and the extension is the astro support', extensionFor('astro')?.language?.name === 'astro', extensionFor('astro')?.language?.name);

  // A fence typed into a file that had none is picked up on the next parse.
  {
    const s2 = EditorState.create({ doc: '<div></div>\n', extensions: [astro()] });
    const t2 = ensureSyntaxTree(s2, 12, 5000);
    check('no fence, no TypeScript', !/Script/.test((() => { const out = []; for (let n = t2.resolveInner(1, 1); n; n = n.parent) out.push(n.name); return out.join(' < '); })()));
    const s3 = s2.update({ changes: { from: 0, insert: '---\nconst a = 1;\n---\n' } }).state;
    const t3 = ensureSyntaxTree(s3, s3.doc.length, 5000);
    check('typing a fence in makes it code', t3.resolveInner(4, 1).name === 'const', t3.resolveInner(4, 1).name);
  }

  if (failures.length) {
    console.error(`astro-language: ${failures.length} of ${checked} checks failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`astro-language: ${checked} checks passed`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
