// A re-read that crosses the panel's own write.
//
//   node test/style-write-race.js
//
// The style panel re-reads every stylesheet on a timer, to notice edits made
// outside it — and it writes those same files, on every tick of a drag. A
// re-read that began before a write and landed after it handed back the file
// as it was BEFORE the write, and that copy replaced the panel's own. The
// canvas showed the dragged padding, the field showed the old one, and the
// next edit — made on the stale copy — wrote the drag out of the file again.
//
// So a read is trusted only when no write to that source overlapped it; any
// other read hands back the doc the panel already holds, which is what it
// just wrote. And the writes themselves are serialised per file: a drag used
// to send one IPC call per frame, none waiting for the last, so the file was
// still being rewritten well after the pointer had stopped.

const fs = require('fs');
const path = require('path');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const esbuild = require('esbuild');
  const buildDir = path.join(__dirname, '..', 'node_modules', '.stacki-test');
  fs.mkdirSync(buildDir, { recursive: true });
  const bundlePath = path.join(buildDir, 'style-write-race.bundle.js');
  await esbuild.build({
    stdin: {
      contents: `
        export { loadEmbedDocs, writeEmbedDoc } from './lib/webflow'
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

  // The main process, stood in for: a disk, and reads and writes that finish
  // when the test says so — the race is in the ordering, so the ordering has
  // to be chosen.
  const disk = new Map();
  const pendingReads = [];
  const pendingWrites = [];
  const writesSent = [];
  dom.window.avb = {
    readStyleFile: (p) => new Promise((resolve) => pendingReads.push(() => resolve({ css: disk.get(p) }))),
    writeStyleFile: ({ filePath, css }) =>
      new Promise((resolve) => {
        writesSent.push(css);
        pendingWrites.push(() => { disk.set(filePath, css); resolve({ ok: true }); });
      }),
  };
  const finishReads = () => { for (const done of pendingReads.splice(0)) done(); };
  const finishWrites = () => { for (const done of pendingWrites.splice(0)) done(); };

  const { loadEmbedDocs, writeEmbedDoc, setHost } = require(bundlePath);
  setHost({ nodes: [], projectPath: '/project', files: [], astroFiles: [] });

  const FILE = '/project/src/styles/a.css';
  const source = {
    key: `file:${FILE}`,
    label: 'a.css',
    classNames: [],
    fromComponent: false,
    componentName: null,
    order: 0,
    element: FILE,
    origin: { kind: 'file', path: FILE },
  };
  const cssOf = (doc) => doc.regions[0].root.toString();
  const setPadding = (doc, value) => {
    const rule = doc.regions[0].root.nodes[0];
    const decl = rule.nodes.find((n) => n.prop === 'padding');
    if (decl) decl.value = value;
    else rule.append({ prop: 'padding', value });
  };

  // The panel's first read: nothing is in the way.
  disk.set(FILE, '.a { padding: 1rem }');
  const first = loadEmbedDocs([source]);
  finishReads();
  const held = (await first).docs[0];
  check('a plain read parses the file', cssOf(held) === '.a { padding: 1rem }', cssOf(held));

  const keep = (key) => (key === source.key ? held : undefined);

  // --- the race ---------------------------------------------------------------
  //
  // A re-read begins. Before its answer comes back, a drag tick writes the
  // file. The answer, when it lands, is the file from before the write.
  {
    const reread = loadEmbedDocs([source], undefined, keep);
    setPadding(held, '2rem');
    const write = writeEmbedDoc(held, true);
    finishReads(); // answers with `padding: 1rem`
    finishWrites();
    await write;
    const { docs } = await reread;
    check('a read that crossed a write hands back the held doc', docs[0] === held, cssOf(docs[0]));
    check('and the held doc still has the edit', cssOf(docs[0]) === '.a { padding: 2rem }', cssOf(docs[0]));
    check('the file has it too', disk.get(FILE) === '.a { padding: 2rem }', disk.get(FILE));
  }

  // The other order: the write is already in flight when the read begins.
  {
    setPadding(held, '3rem');
    const write = writeEmbedDoc(held, true);
    const reread = loadEmbedDocs([source], undefined, keep);
    finishReads(); // still `2rem` on disk — the write has not landed
    finishWrites();
    await write;
    const { docs } = await reread;
    check('a read begun under a write in flight hands back the held doc', docs[0] === held, cssOf(docs[0]));
  }

  // Just after a write has landed, the page model may not have caught up with
  // it yet (a <style> node's write goes through React). A moment's grace.
  {
    const reread = loadEmbedDocs([source], undefined, keep);
    finishReads();
    const { docs } = await reread;
    check('a read right after a write settled keeps the held doc', docs[0] === held);
  }

  // Once things have settled, a read is a read: an edit made outside the app
  // must still come through.
  {
    await sleep(350);
    disk.set(FILE, '.a { padding: 9rem; color: red }');
    const reread = loadEmbedDocs([source], undefined, keep);
    finishReads();
    const { docs } = await reread;
    check('a read clear of any write takes the file as it is', docs[0] !== held && cssOf(docs[0]) === '.a { padding: 9rem; color: red }', cssOf(docs[0]));
  }

  // --- the drag's writes ------------------------------------------------------
  //
  // Sixty ticks a second, each a full write. Only the first goes at once; the
  // rest wait for it, and only the newest of them is ever sent.
  {
    writesSent.length = 0;
    const sent = [];
    for (const value of ['4rem', '5rem', '6rem', '7rem', '8rem']) {
      setPadding(held, value);
      sent.push(writeEmbedDoc(held, true));
    }
    check('the first tick is written at once', writesSent.length === 1 && /4rem/.test(writesSent[0]), writesSent.join(' | '));
    finishWrites();
    await sent[0];
    await sleep(0);
    // The canvas is not waiting on these (it is told the value directly), so
    // the ones behind the first are spaced out: a quarter second, not a frame.
    check('the ticks behind it do not go the moment it lands', writesSent.length === 1, `${writesSent.length}: ${writesSent.join(' | ')}`);
    await sleep(300);
    check('the ticks that queued behind it collapse into one write', writesSent.length === 2, `${writesSent.length}: ${writesSent.join(' | ')}`);
    check('which is the newest', /8rem/.test(writesSent[1] || ''), writesSent[1]);
    finishWrites();
    await Promise.all(sent);
    check('every tick’s promise resolves', true);
    check('and the file ends on the last value', disk.get(FILE) === '.a { padding: 8rem }', disk.get(FILE));
  }

  // A committed edit — the release at the end of a drag — must not sit out that
  // gap behind the tick before it.
  {
    writesSent.length = 0;
    setPadding(held, '1rem');
    const tick = writeEmbedDoc(held, true);
    setPadding(held, '2rem');
    const commit = writeEmbedDoc(held);
    finishWrites(); // the tick lands
    await tick;
    await sleep(0);
    check('a commit queued behind a live write goes at once', writesSent.length === 2 && /2rem/.test(writesSent[1]), writesSent.join(' | '));
    finishWrites();
    await commit;
    check('and is what the file ends on', disk.get(FILE) === '.a { padding: 2rem }', disk.get(FILE));
  }

  if (failures.length) {
    console.error(`style-write-race: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`style-write-race: ${checked} passed  [a re-read never undoes the panel’s own write; a drag writes once per turn]`);
})();
