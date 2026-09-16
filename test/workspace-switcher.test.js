const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

test('workspace picker supports search, keyboard, refresh and failed switches', async () => {
  const outfile = path.join(__dirname, '../node_modules/.stacki-test/workspace-switcher.cjs');
  await require('esbuild').build({
    entryPoints: [path.join(__dirname, '../src/ui/WorkspaceSwitcher.jsx')], outfile,
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'], logLevel: 'silent',
  });
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const WorkspaceSwitcher = require(outfile).default;
  const root = createRoot(document.getElementById('root'));
  const first = { path: '/main', projectPath: '/main', name: 'main', branch: 'main', current: true, available: true };
  const second = { path: '/design', projectPath: '/design', name: 'design', branch: 'feature/design', available: true };
  let rows = [first, second, { path: '/gone', projectPath: '/gone', name: 'gone', available: false }];
  let fetchError = null;
  let selectError = null;
  let finishSwitch;
  let calls = 0;
  const selected = [];
  const prepared = [];
  let onDependencyState;
  window.avb = { gitWorktrees: async () => {
    calls++;
    if (fetchError) throw new Error(fetchError);
    return rows;
  },
    onDependencyState: (cb) => { onDependencyState = cb; return () => { onDependencyState = null; }; },
    prepareWorkspace: async (request) => {
      prepared.push(request);
      second.dependencies = { state: 'installing' };
      return second.dependencies;
    },
  };
  const click = async (el) => { assert.ok(el); await act(async () => el.click()); };
  const trigger = () => document.querySelector('.workspace-trigger');
  const options = () => [...document.querySelectorAll('.workspace-option')];
  const search = async (value) => {
    const input = document.querySelector('input');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  const key = async (el, value) => act(async () => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true })));
  try {
    await act(async () => root.render(React.createElement(WorkspaceSwitcher, {
      project: { path: '/main', name: 'main' },
      onSelect: async (target) => {
        selected.push(target);
        if (selectError) throw new Error(selectError);
        if (finishSwitch === null) await new Promise((resolve) => { finishSwitch = resolve; });
      },
    })));
    await click(trigger());
    assert.equal(options().length, 3);
    assert.equal(options()[0].getAttribute('aria-current'), 'true');
    assert.equal(options()[2].disabled, true);
    await click(options()[0]);
    assert.deepEqual(selected, [], 'current workspace does not reload');
    await click(trigger());
    await key(document.querySelector('input'), 'ArrowUp');
    assert.equal(document.activeElement, options()[1], 'ArrowUp starts at the last available workspace');
    await search('FEATURE/DESIGN');
    assert.equal(options().length, 1);
    await key(document.querySelector('input'), 'ArrowDown');
    assert.equal(document.activeElement, options()[0]);
    await key(document.activeElement, 'Escape');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, trigger());

    await click(trigger());
    await search('missing');
    assert.match(document.body.textContent, /No matching workspaces/);
    await search('design');
    selectError = 'The workspace was removed';
    await key(document.querySelector('input'), 'Enter');
    assert.deepEqual(selected, ['/design']);
    assert.match(document.querySelector('[role="alert"]').textContent, /removed/);
    assert.ok(document.querySelector('[role="dialog"]'), 'failed switches keep the picker open');
    selectError = null;
    finishSwitch = null;
    await click(options()[0]);
    await click(options()[0]);
    assert.equal(selected.length, 2, 'double click cannot start two switches');
    assert.equal(trigger().textContent, 'Switching…');
    await act(async () => finishSwitch());
    assert.equal(document.querySelector('[role="dialog"]'), null);

    fetchError = 'Git failed';
    await click(trigger());
    assert.match(document.querySelector('[role="alert"]').textContent, /Git failed/);
    fetchError = null;
    rows = [first];
    await click(document.querySelector('.workspace-heading button'));
    assert.equal(options().length, 1);
    assert.equal(document.querySelector('[role="alert"]'), null);
    const previousCalls = calls;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    assert.equal(calls, previousCalls + 1);
    await act(async () => document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })));
    assert.equal(document.querySelector('[role="dialog"]'), null);

    second.dependencies = { state: 'missing' };
    rows = [first, second];
    await click(trigger());
    const previousSelections = selected.length;
    await click(document.querySelector('.workspace-prepare'));
    assert.deepEqual(prepared, [{ projectPath: '/main', targetPath: '/design' }]);
    assert.equal(selected.length, previousSelections, 'preparation does not open the other workspace');
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.match(document.body.textContent, /Preparing in background/);
    assert.equal(trigger().disabled, false, 'the current workspace stays usable');
    assert.equal(document.querySelector('.workspace-prepare'), null, 'an active preparation cannot be queued twice');
    await act(async () => onDependencyState({ projectPath: '/design', state: 'failed', error: 'Network unavailable' }));
    assert.match(document.body.textContent, /Network unavailable/);
    assert.equal(document.querySelector('.workspace-prepare').textContent, 'Retry');
    await click(document.querySelector('.workspace-prepare'));
    await act(async () => onDependencyState({ projectPath: '/design', state: 'ready' }));
    assert.match(document.body.textContent, /Dependencies ready/);
    assert.equal(document.querySelector('.workspace-prepare'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('an unavailable destination is refused before project teardown', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const handler = source.slice(source.indexOf("ipcMain.handle('project:close'"), source.indexOf("app.on('window-all-closed'"));
  const actions = [];
  let close;
  const context = {
    ipcMain: { handle: (_name, fn) => { close = fn; } },
    isAstroProject: (next) => next === '/valid',
    devServers: { detach: () => actions.push('detach') },
    stopAllDevServers: () => actions.push('stop-all'), stopAllServices: () => actions.push('services'),
    stopAllPreviews: () => actions.push('preview'), cleanupTerminals: () => actions.push('terminal'),
    acp: { cleanup: () => actions.push('agent') }, watcher: { close: () => actions.push('watcher') },
    openProjectRoot: '/original', pendingProject: null,
    mainWindow: { webContents: { reload: () => actions.push('reload') } },
  };
  require('node:vm').runInNewContext(handler, context);
  await assert.rejects(close(null, '/missing'), /no longer an available Astro project/);
  assert.deepEqual(actions, []);
  assert.equal(context.openProjectRoot, '/original');
  assert.equal(context.pendingProject, null);
  await close(null, '/valid');
  assert.equal(context.pendingProject, '/valid');
  assert.equal(context.openProjectRoot, null);
  assert.deepEqual(actions, ['detach', 'services', 'preview', 'terminal', 'agent', 'watcher', 'reload']);
  actions.length = 0;
  await close(null, null);
  assert.equal(context.pendingProject, null);
  assert.deepEqual(actions, ['stop-all', 'services', 'preview', 'terminal', 'agent', 'reload']);
});
