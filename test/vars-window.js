// The variables sheet opens as a floating window, and pins to a full one.
//
//   node test/vars-window.js
//
// Picking a group in the Variables panel used to cover the canvas with the
// sheet — which hid the only thing a variable is worth changing for. It opens
// over the canvas instead, in the same window the code editor uses (drag by the
// header, resize by any edge), and the pin in that header puts it back across
// the canvas for when the file is what you are reading.
//
// What this checks: which of the two the sheet is in, that both are the same
// live editor (a value typed in the window reaches the file), that the pin says
// which state it is in, and that the header's own controls — the search field —
// are not swallowed by the drag the header carries.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cssVars = require('../electron/cssVars.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const STYLESHEET = `:root {
  /* Swatches */
  --brand-500: #c6fb50;
  --dark-900: #1f1d1e;
}

.theme-dark {
  --brand-500: #8fbf20;
  --dark-900: #000000;
}
`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-varswin-'));
  fs.mkdirSync(path.join(dir, 'src', 'styles'), { recursive: true });
  const file = path.join(dir, 'src', 'styles', 'tokens.css');
  fs.writeFileSync(file, STYLESHEET);

  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundlePath = path.join(buildDir, 'vars-window.bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, '..', 'src', 'panels', 'VariablesView.jsx')],
    outfile: bundlePath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
  });

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.HTMLInputElement = dom.window.HTMLInputElement;

  dom.window.avb = {
    cssVariables: async () => cssVars.readVariables(dir),
    setCssVariable: async ({ projectPath, ...edit }) => cssVars.setVariable(dir, edit),
    writeStyleFile: async ({ filePath, css }) => {
      fs.writeFileSync(String(filePath), css);
      return { ok: true };
    },
    readStyleFile: async (p) => ({ css: fs.readFileSync(typeof p === 'string' ? p : file, 'utf8') }),
    onCssChanged: () => () => {},
    listStyleFiles: async () => ({
      files: [{ path: file, rel: 'src/styles/tokens.css', name: 'tokens.css' }],
    }),
    listAstroStyleFiles: async () => ({ files: [] }),
  };

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react');
  const VariablesView = require(bundlePath).default;

  const container = dom.window.document.getElementById('root');
  const reactRoot = createRoot(container);
  const find = (selector) => container.querySelector(selector);

  let pinned = false;
  const pinCalls = [];
  const show = async () =>
    act(async () => {
      reactRoot.render(
        React.createElement(VariablesView, {
          project: { path: dir },
          selected: { file: 'src/styles/tokens.css', index: 0 },
          hidden: false,
          pinned,
          onTogglePin: (next) => pinCalls.push(next),
          onClose: () => {},
          showToast: () => {},
          onRecordUndo: () => {},
        })
      );
      await settle(40);
    });

  // --- opening: a window over the canvas, not a sheet across it -------------
  await show();
  const win = find('.float-win.vars-window');
  check('the sheet opens in a floating window', !!win, container.innerHTML.slice(0, 300));
  check('which is the same shell the code editor uses', !!find('.float-win-header'));
  check('so the canvas is not covered', !find('.cms-view'), find('.cms-view')?.className);
  check('and the tables are inside it', !!win?.querySelector('.vars-table'));
  check(
    'the window is placed, not laid out',
    !!win && win.style.left !== '' && win.style.width !== '',
    `${win?.style.left} / ${win?.style.width}`
  );
  // The group's name titles the window; the stylesheet it came from is the
  // tooltip, since there is no room for a path in a header this size.
  check('titled with the group', find('.float-win-title')?.textContent === ':root', find('.float-win-title')?.textContent);
  check(
    'and the file is the title\'s tooltip',
    find('.float-win-title')?.getAttribute('title') === 'src/styles/tokens.css',
    find('.float-win-title')?.getAttribute('title')
  );
  check('the search moved into the header', !!find('.float-win-header .vars-search'));
  check('so does the saved chip', !!find('.float-win-header .cms-saved'));

  // --- it is the live editor, not a preview of one -------------------------
  {
    const input = [...container.querySelectorAll('.var-input')].find((n) => n.value === '#c6fb50');
    check('a value is editable in the window', !!input, `${container.querySelectorAll('.var-input').length} fields`);
    const setValue = dom.window.Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value'
    ).set;
    await act(async () => {
      setValue.call(input, '#ff0000');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
      await settle(80);
    });
    check(
      'and typing it writes the stylesheet',
      /--brand-500:\s*#ff0000/.test(fs.readFileSync(file, 'utf8')),
      fs.readFileSync(file, 'utf8').split('\n').slice(0, 5).join('\n')
    );
  }

  // --- the header drags, but not by its own controls ------------------------
  {
    const header = find('.float-win-header');
    const press = (target, x = 500) =>
      act(async () => {
        target.dispatchEvent(
          new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: 100 })
        );
        dom.window.dispatchEvent(
          new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: x + 40, clientY: 140 })
        );
        dom.window.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
        await settle(0);
      });

    const at = () => find('.float-win').style.left;
    const start = at();
    await press(find('.float-win-header .vars-search'));
    check('pressing the search field does not drag the window', at() === start, `${start} → ${at()}`);
    await press(header);
    check('pressing the header itself does', at() !== start, `${start} → ${at()}`);
  }

  // --- the pin ---------------------------------------------------------------
  {
    const pin = find('.float-win-header .vars-pin');
    check('the window carries a pin', !!pin, find('.float-win-header')?.innerHTML.slice(0, 300));
    check('which says it is not pinned', pin?.getAttribute('aria-pressed') === 'false', pin?.outerHTML.slice(0, 120));
    await act(async () => {
      pin.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle(0);
    });
    check('pressing it asks to pin', pinCalls.join() === 'true', pinCalls.join());
  }

  // --- pinned: the full sheet, the way it used to open ----------------------
  pinned = true;
  await show();
  check('pinned, the sheet covers the canvas', !!find('.cms-view.vars-view'), container.innerHTML.slice(0, 200));
  check('and the window is gone', !find('.float-win'));
  check('the sheet keeps its own head', !!find('.cms-detail-head'));
  check('with the file path on it', find('.cms-detail-path')?.textContent === 'src/styles/tokens.css');
  check('the tables are still drawn', !!find('.vars-table'));
  {
    const pin = find('.cms-detail-head .vars-pin');
    check('the pin is on the same head', !!pin, find('.cms-detail-head')?.innerHTML.slice(0, 300));
    check('and says it is pinned', pin?.getAttribute('aria-pressed') === 'true', pin?.outerHTML.slice(0, 120));
    check('lit, so the state reads at a glance', pin?.classList.contains('on'), pin?.className);
    await act(async () => {
      pin.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await settle(0);
    });
    check('pressing it asks to float again', pinCalls.join() === 'true,false', pinCalls.join());
  }

  // --- hidden: kept mounted, so an unsaved edit survives another panel ------
  await act(async () => {
    reactRoot.render(
      React.createElement(VariablesView, {
        project: { path: dir },
        selected: { file: 'src/styles/tokens.css', index: 0 },
        hidden: true,
        pinned: false,
        onTogglePin: () => {},
        onClose: () => {},
        showToast: () => {},
        onRecordUndo: () => {},
      })
    );
    await settle(40);
  });
  check(
    'a hidden window is still mounted, just not shown',
    !!find('.float-win') && find('.float-win').classList.contains('hidden'),
    find('.float-win')?.className
  );

  await act(async () => reactRoot.unmount());
  fs.rmSync(dir, { recursive: true, force: true });

  if (failures.length) {
    console.error(`\nvars-window: ${failures.length} failed, ${checked - failures.length} passed\n`);
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  console.log(`vars-window: ${checked} passed  [floating by default, pinned by the pin]`);
})();
