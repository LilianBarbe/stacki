// What the branch chip reloads, and what it leaves alone.
//
//   node --test test/git-chip-reload.test.js
//
// Every action in the chip used to end with a full working-tree reload: the
// open file re-read from disk, the page's undo history dropped, every preview
// iframe remounted. That is right after a checkout, which rewrites the files
// under the app — and wrong after deleting a branch, which moves a ref and
// touches nothing. It went unnoticed because the same delete offered by the
// History panel never did it, so the two buttons quietly disagreed.
//
// The cost was not theoretical: deleting a merged branch from the chip blanked
// the canvas, because the reload remounts the iframes whether or not there is
// anything new to show.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the chip reloads the working tree for a checkout and not for a delete', async () => {
  const buildDir = path.join(__dirname, '../node_modules/.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  // One bundle, not two: confirmDialog talks to the mounted host through a
  // module-level binding, and a second copy of that module would answer "no"
  // to every question this test asks.
  const entry = path.join(buildDir, 'git-chip-entry.jsx');
  const src = path.join(__dirname, '..', 'src');
  fs.writeFileSync(
    entry,
    `export { default as GitChip } from ${JSON.stringify(path.join(src, 'panels/GitChip.jsx'))};\n` +
      `export { ConfirmHost } from ${JSON.stringify(path.join(src, 'ui/ConfirmDialog.jsx'))};\n`
  );
  const outfile = path.join(buildDir, 'git-chip-reload.cjs');
  await require('esbuild').build({
    entryPoints: [entry], outfile,
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'], logLevel: 'silent',
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { GitChip, ConfirmHost } = require(outfile);

  const info = {
    isRepo: true,
    branch: 'main',
    branches: ['main', 'design'],
    trunk: 'main',
    parked: [],
    elsewhere: {},
    dirty: false,
    dirtyFiles: [],
    remote: null,
    hasUpstream: false,
    ahead: 0,
    head: 'abc1234',
  };
  const calls = [];
  let reloads = 0;
  window.avb = {
    gitInfo: async () => info,
    gitDeleteBranch: async (a) => { calls.push(['delete', a.branch]); return { ok: true }; },
    gitCheckout: async (a) => { calls.push(['checkout', a.branch]); return {}; },
    gitCommit: async () => { calls.push(['commit']); return {}; },
    gitStatus: async () => [],
  };

  const root = createRoot(document.getElementById('root'));
  const click = async (el) => { assert.ok(el, 'nothing to click'); await act(async () => el.click()); };
  const byText = (label) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const rowFor = (branch) =>
    [...document.querySelectorAll('.list-item')].find(
      (r) => r.querySelector('.label')?.textContent === branch
    );

  try {
    await act(async () => root.render(
      React.createElement(React.Fragment, null,
        React.createElement(GitChip, {
          project: { path: '/p', name: 'p' },
          showToast: () => {},
          flushSave: async () => {},
          onWorktreeChanged: async () => { reloads++; },
        }),
        React.createElement(ConfirmHost))
    ));

    await click(document.querySelector('.git-chip'));
    // Deleting a branch: git moves a ref, the files stay put.
    await click(rowFor('design').querySelector('.branch-action'));
    await click(byText('Delete branch'));
    assert.deepEqual(calls, [['delete', 'design']]);
    assert.equal(reloads, 0, 'deleting a branch must not reload the working tree');

    // Switching to one: the files under the app are rewritten, so it must.
    await click(rowFor('design'));
    assert.deepEqual(calls.at(-1), ['checkout', 'design']);
    assert.equal(reloads, 1, 'a checkout reloads what is open');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
