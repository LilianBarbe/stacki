const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const {
  componentPreviewInputs,
  componentPreviewPath,
  renderComponentPreviewPage,
} = require('../electron/componentPreview');

const component = `---
interface Props {
  heading: string;
  render?: boolean;
  variant: 'primary' | 'secondary';
  size?: 'small' | 'large';
  href?: string;
}
const { heading, render, variant } = Astro.props;
---
{render && <h2>{heading}</h2>}`;

test('preview inputs reveal guarded text without inventing links or optional variants', () => {
  assert.deepEqual(componentPreviewInputs(component, 'Heading'), {
    props: { heading: 'Heading', render: true, variant: 'primary' },
  });
  const defaults = `---
interface Props { title: string; label: string; render: boolean; text: string; }
const { title = '', label = 'Authored', render = false, text = mustNotRun() } = Astro.props;
---
<p>{title}</p>`;
  assert.deepEqual(componentPreviewInputs(defaults, 'Sample'), { props: {} });
});

test('preview URLs select the exact component or layout and respect trailing slashes', async () => {
  const { componentPreviewUrl } = await import('../src/componentPreview.js');
  const paths = ['/src/components/Card.astro', '/src/components/Cards/Card.astro',
    '/src/layouts/Base.astro'];
  for (const item of [
    { name: 'Card', folder: 'Cards' },
    { name: 'Base', folder: 'layouts', isLayout: true },
  ]) {
    for (const trailingSlash of ['always', 'never', 'ignore']) {
      const url = new URL(componentPreviewUrl('http://localhost:4321/', item, trailingSlash));
      assert.equal(url.pathname, trailingSlash === 'always' ? '/__avb/preview/' : '/__avb/preview');
      const expected = item.isLayout ? paths[2] : paths[1];
      assert.equal(componentPreviewPath(paths, url.searchParams.get('p'), url.searchParams.get('c')), expected);
    }
  }
  assert.equal(componentPreviewPath(paths, '', 'Card'), paths[0]);
  assert.equal(componentPreviewPath(paths, 'src/components/Missing.astro', 'Card'), undefined);
  assert.equal(componentPreviewPath(paths, '../outside.astro', 'Card'), undefined);
});

test('generated config loads the preview plugin and compiles its Astro page', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-component-preview-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, 'src/components/Heading.astro');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, component);
  fs.writeFileSync(path.join(temp, 'astro.config.mjs'),
    "export default { trailingSlash: 'always', vite: { plugins: [{ name: 'user-plugin' }] } };");
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const start = main.indexOf('function parsesAsModule(');
  const end = main.indexOf('// Astro 7.1+', start);
  const context = {
    fs, path, spawnSync, renderComponentPreviewPage,
    __dirname: path.resolve(__dirname, '../electron'),
    resolveNodeBin: () => process.execPath,
    toPosix: (value) => value.split(path.sep).join('/'),
    MORPH_CLIENT: '', MORPH_TAG_HTML: '', PATHS_ENDPOINT: '', DATA_ENDPOINT: '',
  };
  vm.createContext(context);
  vm.runInContext(main.slice(start, end), context);
  const configPath = context.writeMarkerConfig(temp);
  assert.ok(configPath, 'the generated config passes its startup checks');
  const { default: config } = await import(pathToFileURL(configPath).href);
  assert.equal(config.trailingSlash, 'always');
  assert.ok(config.vite.plugins.some((plugin) => plugin.name === 'user-plugin'));
  const plugin = config.vite.plugins.find((plugin) => plugin.name === 'avb-component-preview');
  assert.ok(plugin);
  const metadata = plugin.load(fs.realpathSync(file) + '?raw&stacki-preview-props');
  const { default: inputs } = await import('data:text/javascript,' + encodeURIComponent(metadata));
  assert.deepEqual(inputs, componentPreviewInputs(component, 'Heading'));
  assert.equal(plugin.load(file + '?raw'), undefined);
  assert.throws(() => plugin.load(path.join(temp, 'src/pages/index.astro') + '?raw&stacki-preview-props'));
  assert.equal(fs.readFileSync(file, 'utf8'), component, 'preview does not modify the project component');
  const preview = fs.readFileSync(path.join(path.dirname(configPath), 'preview.astro'), 'utf8');
  const { transform } = await import('@astrojs/compiler');
  const compiled = await transform(preview, { filename: 'preview.astro' });
  assert.ok(compiled.code);
  assert.ok(!compiled.diagnostics?.some((item) => item.severity === 1));
  assert.ok(!preview.includes('background: #f2f2f2'));
});
