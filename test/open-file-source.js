// An open component's CSS has one home, not two.
//
//   node test/open-file-source.js
//
// A component's `<style is:global>` reaches the style panel one of two ways:
// read from its FILE while the page is open, or from the page MODEL once that
// component is opened for editing — the model is then the only thing allowed
// to write the file, so styleSources leaves the file out. The panel cached the
// component sources from its first scan, at module scope, and went on reading
// the file copy after the component was opened. Two docs for one block: an
// edit landed in the file behind the model's back, the model kept showing the
// old values, and its next save would have written them straight back over
// the edit.
//
// The first half here is the source list itself. The second reads the panel's
// source: the cache is gone, and opening a file counts as the sheet list
// changing, so the panel re-lists at once rather than on its next poll.

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
  const bundlePath = path.join(buildDir, 'open-file-source.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { scanPage, scanAllComponents } from './lib/webflow'
        export { setHost } from './lib/host'
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

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  dom.window.avb = {};

  const { scanPage, scanAllComponents, setHost } = require(bundlePath);

  const FOOTER = '/project/src/components/Footer.astro';
  const PAGE = '/project/src/pages/index.astro';
  const footerFile = { rel: 'src/components/Footer.astro', name: 'Footer.astro', path: FOOTER, size: 1 };
  const keysOf = (sources) => sources.map((s) => s.key);

  // The page is open: the footer's global block is read from its file.
  setHost({ projectPath: '/project', files: [], astroFiles: [footerFile], openFilePath: PAGE, nodes: [] });
  {
    const page = await scanPage();
    const all = await scanAllComponents();
    check('with the page open, the component file is a source', keysOf(page.pageEmbeds).includes(`astro:${FOOTER}`), keysOf(page.pageEmbeds).join('|'));
    check('and the component scan lists the same sources', keysOf(all).join('|') === keysOf(page.pageEmbeds).join('|'), keysOf(all).join('|'));
  }

  // The footer is opened: its block is now a node of the model, and the file
  // must not be read beside it.
  const styleNode = { id: 'n9', kind: 'raw', name: 'style', props: { 'is:global': { type: 'bare' } }, inner: '.footer_links { gap: 1rem }' };
  setHost({ openFilePath: FOOTER, nodes: [{ id: 'n1', kind: 'element', name: 'footer', props: {}, children: [] }, styleNode] });
  {
    const page = await scanPage();
    const all = await scanAllComponents();
    check('with the component open, its block comes from the model', keysOf(page.pageEmbeds).includes('node:n9'), keysOf(page.pageEmbeds).join('|'));
    check('and its file is not read as well', !keysOf(page.pageEmbeds).includes(`astro:${FOOTER}`), keysOf(page.pageEmbeds).join('|'));
    check('the component scan agrees', !keysOf(all).includes(`astro:${FOOTER}`) && keysOf(all).includes('node:n9'), keysOf(all).join('|'));
  }

  // --- the panel's side of it, read from the source ---------------------------
  const editor = fs.readFileSync(path.join(__dirname, '..', 'src', 'style-panel', 'EmbedEditor.tsx'), 'utf8');
  check(
    'the component sources are not cached across builds',
    !/cachedComponentSources/.test(editor),
    'a module-scope cache would keep listing a file after it became the open model'
  );
  const signature = editor.slice(editor.indexOf('function sheetSignature'), editor.indexOf('\n}', editor.indexOf('function sheetSignature')));
  check('opening a file counts as the sheet list changing', /openFilePath/.test(signature), signature);
  const build = editor.slice(editor.indexOf('const componentPromise'), editor.indexOf('const [pageResult, componentResult]'));
  check('sources the page scan already lists are not read twice', /pageKeys/.test(build) && /filter/.test(build), build.slice(0, 300));

  if (failures.length) {
    console.error(`open-file-source: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`open-file-source: ${checked} passed  [an open component's block is read from the model only]`);
})();
