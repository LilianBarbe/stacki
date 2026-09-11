const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test', 'renderer-core');
fs.mkdirSync(buildDir, { recursive: true });
esbuild.buildSync({
  entryPoints: ['editorTree', 'loopBindings', 'pagePersistence'].map((name) => path.join(__dirname, '..', 'src', `${name}.js`)),
  outdir: buildDir, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent',
});
const tree = require(path.join(buildDir, 'editorTree.js'));
const loops = require(path.join(buildDir, 'loopBindings.js'));
const { createPageSaver, scanContainsFile } = require(path.join(buildDir, 'pagePersistence.js'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(setImmediate);

test('tree index preserves locations, ancestry and anchors after moves', () => {
  const leaf = { id: 'leaf', props: { id: { type: 'string', value: 'anchor' } }, children: null };
  const nodes = [{ id: 'first', children: [leaf] }, { id: 'second', children: [] }];
  const index = tree.createTreeIndex(nodes);
  assert.equal(index.node('leaf'), leaf);
  assert.equal(index.parent('leaf'), nodes[0]);
  assert.equal(index.path('leaf'), '0.0');
  assert.deepEqual(index.ancestors('leaf'), [nodes[0], leaf]);
  assert.deepEqual(index.sectionIds, ['anchor']);
  assert.equal(index.byPath.get('0.0'), leaf);
  assert.equal(index.path('missing'), null);
  assert.equal(index.parent('first'), null);
  assert.equal(tree.isDescendantOf(leaf, 'leaf'), true);
  nodes[1].children.push(nodes[0].children.pop());
  assert.equal(tree.findParentNode(nodes, 'leaf'), nodes[1]);
  assert.deepEqual(tree.pathOfNode(nodes, 'leaf'), [1, 0]);
  assert.deepEqual(tree.ancestorChain(nodes, 'leaf'), [nodes[1], leaf]);
  assert.equal(tree.nodeAtPath(nodes, [1, 0]), leaf);
  assert.equal(tree.createTreeIndex(nodes).path('leaf'), '1.0');
  assert.deepEqual(tree.findParentList({ nodes }, 'leaf'), { list: nodes[1].children, index: 0 });
});

test('deep tree lookup does not exhaust the JavaScript call stack', () => {
  let node = { id: 'leaf' };
  for (let i = 0; i < 15000; i++) node = { id: `parent${i}`, children: [node] };
  assert.equal(tree.findNodeById([node], 'leaf').id, 'leaf');
  assert.equal(tree.pathOfNode([node], 'leaf').length, 15001);
});

test('loop renames preserve dollar identifiers, property names and nested shadows', () => {
  const nodes = [
    { kind: 'expr', value: '{$item.label + $items.label + other.$item}' },
    { kind: 'text', value: '$item prose {$item.label}' },
    { kind: 'map', head: '$item.children.map(($item) => (', body: ['const title = $item.title;'], children: [{ kind: 'expr', value: '{$item.title}' }] },
    { kind: 'map', head: '$item.children.map((child) => (', body: ['const title = $item.title;'], children: [{ kind: 'expr', value: '{$item.title}' }] },
  ];
  loops.renameLoopVar(nodes, '$item', 'next$');
  assert.equal(nodes[0].value, '{next$.label + $items.label + other.$item}');
  assert.equal(nodes[1].value, '$item prose {next$.label}');
  assert.equal(nodes[2].head, 'next$.children.map(($item) => (');
  assert.equal(nodes[2].body[0], 'const title = $item.title;');
  assert.equal(nodes[2].children[0].value, '{$item.title}');
  assert.equal(nodes[3].body[0], 'const title = next$.title;');
  assert.equal(nodes[3].children[0].value, '{next$.title}');
});

test('moving from a loop drops lost bindings without rewriting nested local variables', () => {
  const node = { kind: 'element', props: {
    href: { type: 'expr', value: 'item$.url' },
    title: { type: 'expr', value: 'other.item$' },
  }, children: [
    { kind: 'expr', value: '{item$.label}' },
    { kind: 'map', head: 'item$.children.map((item$) => (', body: ['const title = item$.title;'], children: [{ kind: 'expr', value: '{item$.label}' }] },
  ] };
  assert.equal(loops.stripLostBindings(node, ['item$']), 3);
  assert.equal(node.props.href, undefined);
  assert.equal(node.props.title.value, 'other.item$');
  assert.equal(node.children[0].value, 'content');
  assert.equal(node.children[1].head, '[].map((item$) => (');
  assert.equal(node.children[1].body[0], 'const title = item$.title;');
  assert.equal(node.children[1].children[0].value, '{item$.label}');
});

test('saving serializes concurrent writes and drains newer edits before navigation', async () => {
  const first = { dirty: true, model: { version: 1 } };
  const second = { dirty: true, model: { version: 2 } };
  let current = { currentPage: { path: '/page.astro' }, pageState: first };
  const writes = [];
  const gates = [];
  const save = createPageSaver({
    readCurrent: () => current,
    write: (path, state) => { writes.push({ path, state }); const gate = deferred(); gates.push(gate); return gate.promise; },
    markSaved: (saved) => { if (current.pageState === saved) current = { ...current, pageState: { ...saved, dirty: false } }; },
  });
  const one = save();
  await tick();
  current = { ...current, pageState: second };
  const two = save();
  await tick();
  assert.equal(writes.length, 1);
  gates[0].resolve();
  await tick();
  assert.equal(current.pageState.dirty, true);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].state, second);
  gates[1].resolve();
  await Promise.all([one, two]);
  assert.equal(current.pageState.dirty, false);
  assert.equal(writes.length, 2);
});

test('failed saves can retry and completing an old save never cleans another page', async () => {
  let current = { currentPage: { path: '/first.astro' }, pageState: { dirty: true } };
  let gate = deferred();
  const saved = [];
  const save = createPageSaver({
    readCurrent: () => current,
    write: () => gate.promise,
    markSaved: (state) => saved.push(state),
  });
  const failed = save();
  gate.reject(new Error('disk full'));
  await assert.rejects(failed, /disk full/);
  assert.deepEqual(saved, []);
  gate = deferred();
  const retry = save();
  await tick();
  const first = current.pageState;
  current = { currentPage: { path: '/second.astro' }, pageState: { dirty: true } };
  gate.resolve();
  await retry;
  assert.deepEqual(saved, [first]);
  assert.equal(current.pageState.dirty, true);
});

test('external edits recognize pages, components and layouts as editable files', () => {
  const scan = { pages: [{ path: 'a.astro' }], components: [{ path: 'b.astro' }], layouts: [{ path: 'c.astro' }] };
  for (const file of ['a.astro', 'b.astro', 'c.astro']) assert.equal(scanContainsFile(scan, file), true);
  assert.equal(scanContainsFile(scan, 'deleted.astro'), false);
});

test('code window saves keep each file and flush the latest version in order', async () => {
  const { createFileSaver } = require(path.join(buildDir, 'pagePersistence.js'));
  const writes = [];
  const saver = createFileSaver({ delay: 10000 });
  saver.schedule('a.css', async () => writes.push('a:old'));
  saver.schedule('b.css', async () => writes.push('b:current'));
  saver.schedule('a.css', async () => writes.push('a:current'));
  await saver.flush();
  assert.deepEqual(writes.sort(), ['a:current', 'b:current']);
  const gate = deferred();
  saver.schedule('a.css', async () => { writes.push('a:pending'); await gate.promise; });
  const first = saver.flush();
  await tick();
  saver.schedule('a.css', async () => writes.push('a:newest'));
  const second = saver.flush();
  await tick();
  assert.equal(writes.includes('a:newest'), false);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes.slice(-2), ['a:pending', 'a:newest']);
});

test('failed code window writes are retained for an explicit retry', async () => {
  const { createFileSaver } = require(path.join(buildDir, 'pagePersistence.js'));
  let fail = true;
  let attempts = 0;
  const errors = [];
  const saver = createFileSaver({ delay: 10000, onError: (error) => errors.push(error.message) });
  saver.schedule('a.css', async () => { attempts++; if (fail) throw new Error('disk full'); });
  await assert.rejects(saver.flush(), /disk full/);
  assert.deepEqual(errors, ['disk full']);
  fail = false;
  await saver.flush();
  assert.equal(attempts, 2);
});
