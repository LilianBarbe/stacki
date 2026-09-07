// Astro's console, in the terminal dock.
//
//   node test/dev-log.js
//
// The dev server's output has always reached the renderer — main pipes the
// child's stdout/stderr out as `dev:log` — but the only thing that ever
// displayed it was the preview's offline screen. So a warning, or a route
// that quietly 500s, was invisible for as long as the canvas still looked
// fine, and the answer was to leave the app and run `astro dev` by hand.
//
// The dock now opens on that stream: a pinned first tab, ahead of the shells.
// What this pins down is the tab arithmetic around it — it is the one tab that
// cannot be closed, so every path that picks an active tab has to have
// somewhere to land — and that the pane really does subscribe to the stream
// rather than only drawing a tab that says it does.

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
  const entry = path.join(buildDir, 'dev-log.entry.jsx');
  fs.writeFileSync(
    entry,
    `export { default as TerminalDock } from ${JSON.stringify(
      path.join(__dirname, '..', 'src', 'panels', 'TerminalDock.jsx')
    )};\n`
  );
  const bundle = path.join(buildDir, 'dev-log.bundle.js');
  await esbuild.build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.MutationObserver = dom.window.MutationObserver;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.MouseEvent = dom.window.MouseEvent;
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.Element.prototype.scrollIntoView = function () {};
  // xterm probes a canvas to measure its font; jsdom's throws a "not
  // implemented" line across the suite's output rather than failing, and the
  // renderer falls back on its own. Nothing here reads a glyph.
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;

  // The panes only build their terminal once the host has been measured — the
  // dock is collapsed until it is opened, and a zero-sized xterm throws. jsdom
  // lays nothing out, so give every element a size and let the observer fire.
  for (const prop of ['offsetWidth', 'offsetHeight']) {
    Object.defineProperty(dom.window.HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return 600;
      },
    });
  }
  const observers = [];
  dom.window.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  global.ResizeObserver = dom.window.ResizeObserver;

  // --- the preload bridge, as much of it as the dock reaches for ------------
  const devLogListeners = new Set();
  const started = [];
  const closed = [];
  dom.window.avb = {
    platform: 'darwin',
    startTerminal: async ({ id }) => {
      started.push(id);
      return { ok: true };
    },
    closeTerminal: ({ id }) => closed.push(id),
    terminalInput: () => {},
    terminalAck: () => {},
    resizeTerminal: () => {},
    nativePaste: () => {},
    getFilePath: () => '',
    terminalClipboardImage: async () => ({ ok: false }),
    onTerminalData: () => () => {},
    onTerminalExit: () => () => {},
    onTerminalProcess: () => () => {},
    onDevLog: (cb) => {
      devLogListeners.add(cb);
      return () => devLogListeners.delete(cb);
    },
    onDevExit: () => () => {},
  };

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const { TerminalDock } = require(bundle);

  const host = document.createElement('div');
  document.getElementById('root').appendChild(host);
  const root = createRoot(host);

  const restarts = [];
  const logRef = { current: 'watching for file changes...\n' };
  const render = async (props) => {
    await act(async () => {
      root.render(
        React.createElement(TerminalDock, {
          projectPath: '/tmp/project',
          open: true,
          onClose: () => {},
          devLogRef: logRef,
          devStatus: 'on',
          onRestartDev: () => restarts.push(1),
          ...props,
        })
      );
    });
    // The panes wait on the ResizeObserver, which jsdom never fires by itself.
    await act(async () => {
      for (const o of observers) o.cb?.([]);
    });
  };

  const tabs = () => [...host.querySelectorAll('.term-tab')];
  const labelOf = (tab) => tab.querySelector('.term-tab-label')?.textContent;
  const activeLabel = () => labelOf(tabs().find((t) => t.classList.contains('on')));
  const click = async (el) => {
    await act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

  await render();

  // --- the tab itself ------------------------------------------------------
  check('the dock has an Astro tab', labelOf(tabs()[0]) === 'Astro', tabs().map(labelOf).join(', '));
  check('it comes before the shells', tabs().length > 1 && labelOf(tabs()[0]) === 'Astro');
  check('and it is what the dock opens on', activeLabel() === 'Astro', String(activeLabel()));
  check(
    'the shell is ready behind it, not in front of it',
    tabs().length === 2 && !tabs()[1].classList.contains('on')
  );
  check(
    'and it cannot be closed',
    !tabs()[0].querySelector('.term-tab-x'),
    'the pane it hides has no other way back'
  );

  // --- it is really on the stream -----------------------------------------
  check(
    'the pane is listening to dev:log',
    devLogListeners.size === 1,
    `${devLogListeners.size} listeners`
  );
  let threw = null;
  await act(async () => {
    try {
      for (const cb of devLogListeners) cb('[astro] 200 GET /\n');
    } catch (err) {
      threw = err;
    }
  });
  check('and a chunk written to it lands', !threw, threw && String(threw));

  // --- switching, and closing back onto it ---------------------------------
  await click(tabs()[1]);
  check('a shell tab takes the dock when clicked', activeLabel() !== 'Astro');

  await click(host.querySelector('.term-add'));
  check('the second shell opens focused', tabs().length === 3 && !tabs()[0].classList.contains('on'));

  await click(tabs()[2].querySelector('.term-tab-x'));
  await click(tabs()[1].querySelector('.term-tab-x'));
  check('closing the last shell falls back to Astro', activeLabel() === 'Astro', String(activeLabel()));
  check('rather than to an empty dock', host.querySelector('.term-pane') !== null);

  // --- restart -------------------------------------------------------------
  await click(host.querySelector('.devlog-restart'));
  check('the pane restarts the server', restarts.length === 1, `${restarts.length} restarts`);

  await render({ devStatus: 'starting' });
  check(
    'and says so while it comes up',
    host.querySelector('.devlog-actions .status-dot.starting') !== null
  );
  check(
    'with the button held until it is up',
    host.querySelector('.devlog-restart')?.disabled === true
  );

  // --- teardown ------------------------------------------------------------
  await act(async () => root.unmount());
  check(
    'closing the dock drops the listener',
    devLogListeners.size === 0,
    `${devLogListeners.size} left behind`
  );

  if (failures.length) {
    console.error(`\ndev-log: ${failures.length} failed, ${checked - failures.length} passed\n`);
    console.error(failures.join('\n') + '\n');
    process.exit(1);
  }
  console.log(`dev-log: ${checked} passed  [Astro's console in the dock]`);
  process.exit(0);
})();
