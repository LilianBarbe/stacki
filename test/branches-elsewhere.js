// The branches another folder is sitting on.
//
//   node test/branches-elsewhere.js
//
// A branch is checked out in one place at a time, and an agent runner makes a
// folder per task — so a project picked up from Conductor or the like has a
// branch list that is mostly other people's folders, none of which this app
// can switch to. They come out of the list (electron/gitHistory.js) and the
// history panel goes on showing them as the places they are.
//
// Against real repositories and real worktrees, because every case here is a
// shape of git's output or of the filesystem:
//
//   - macOS resolves the temp directory through /private, so the path git
//     prints and the path the app holds are different strings for one folder.
//     Compared naively, no worktree matches this one and the branch you are
//     standing on disappears from the switcher.
//   - a worktree whose folder has been deleted is still in git's list, marked
//     prunable. Its branch is free, so it is an ordinary branch.
//   - the preview checkout is a worktree with no branch at all.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const history = require('../electron/gitHistory.js');
const { switchBranch } = require('../electron/gitBranches.js');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

// LC_ALL as main.js's runner sets it: git is translated, and the code under
// test reads git's words.
const git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1 << 24, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });

const sh = async (dir, ...args) => (await git(dir, args)).stdout.trim();

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-elsewhere-'));
  const main = path.join(root, 'project');
  fs.mkdirSync(main);
  await sh(main, 'init', '-q', '-b', 'main', '.');
  await sh(main, 'config', 'user.email', 'tim@example.com');
  await sh(main, 'config', 'user.name', 'Tim Ricks');
  fs.writeFileSync(path.join(main, 'index.astro'), '<h1>Home</h1>\n');
  await sh(main, 'add', '-A');
  await sh(main, 'commit', '-q', '-m', 'first');

  // Two folders an agent runner would have made, one branch that nobody has
  // taken, and the app's own preview checkout — which is detached.
  await sh(main, 'branch', 'background-bleu');
  await sh(main, 'branch', 'tous-les-textes-en-rouge');
  await sh(main, 'branch', 'conductor-settings-local');
  const blue = path.join(root, 'islamabad');
  const red = path.join(root, 'miami');
  const gone = path.join(root, 'gaborone');
  await sh(main, 'worktree', 'add', '-q', blue, 'background-bleu');
  await sh(main, 'worktree', 'add', '-q', red, 'tous-les-textes-en-rouge');
  await sh(main, 'worktree', 'add', '-q', '--detach', path.join(main, '.stacki', 'preview'), 'HEAD');

  const seen = await history.worktrees(git, { projectPath: main });
  check('every folder is listed', seen.length === 4, JSON.stringify(seen.map((w) => w.branch)));
  check(
    'each carries its branch',
    seen.some((w) => w.branch === 'background-bleu') && seen.some((w) => w.branch === 'tous-les-textes-en-rouge'),
    JSON.stringify(seen.map((w) => w.branch))
  );
  check(
    'the preview checkout has none',
    seen.some((w) => w.detached && !w.branch),
    JSON.stringify(seen)
  );

  // The paths are compared, not the strings: main is under /var here and git
  // prints /private/var.
  const here = await sh(main, 'rev-parse', '--show-toplevel');
  let elsewhere = history.branchesElsewhere(seen, main);
  check('this folder is not elsewhere', !('main' in elsewhere), JSON.stringify(elsewhere));
  // The path comes back as git printed it — that is the one to show someone
  // looking for the folder, and on macOS it is /private/var where the app's is
  // /var. Same place, and that is what the comparison has to be about.
  const real = (p) => fs.realpathSync(p);
  check('the blue folder is', elsewhere['background-bleu'] === real(blue), JSON.stringify(elsewhere));
  check('and the red one', elsewhere['tous-les-textes-en-rouge'] === real(red), JSON.stringify(elsewhere));
  check(
    'a branch nobody has open stays a branch',
    !('conductor-settings-local' in elsewhere),
    JSON.stringify(elsewhere)
  );
  check('and the detached preview names nothing', Object.values(elsewhere).every((p) => p !== path.join(main, '.stacki', 'preview')), JSON.stringify(elsewhere));
  check(
    'the path git prints works the same as the one the app holds',
    JSON.stringify(history.branchesElsewhere(seen, here)) === JSON.stringify(elsewhere),
    `${here} vs ${main}`
  );

  // Standing in one of those folders, the others — including main — are the
  // ones open elsewhere, and this one's own branch is not.
  const fromBlue = history.branchesElsewhere(await history.worktrees(git, { projectPath: blue }), blue);
  check('from another folder, main is elsewhere', fromBlue.main === (await sh(main, 'rev-parse', '--show-toplevel')), JSON.stringify(fromBlue));
  check('and its own branch is not', !('background-bleu' in fromBlue), JSON.stringify(fromBlue));

  // A folder that was deleted without `git worktree remove` — an archived
  // agent workspace ends this way. Git still lists it, marked prunable, and
  // goes on holding the branch: `git switch` refuses it, naming a folder that
  // is not there any more.
  await sh(main, 'worktree', 'add', '-q', gone, 'conductor-settings-local');
  fs.rmSync(gone, { recursive: true, force: true });
  const afterRemoval = await history.worktrees(git, { projectPath: main });
  const stale = afterRemoval.find((w) => w.branch === 'conductor-settings-local');
  check('a deleted folder is still listed', !!stale, JSON.stringify(afterRemoval.map((w) => w.path)));
  check('and marked prunable', !!(stale && stale.prunable), JSON.stringify(stale));
  elsewhere = history.branchesElsewhere(afterRemoval, main);
  check(
    'and its branch is still held',
    // Not compared through realpath: the folder is gone, so there is nothing
    // left on disk to resolve it against — the case samePlace falls back for.
    String(elsewhere['conductor-settings-local']).endsWith('/gaborone'),
    JSON.stringify(elsewhere)
  );
  let stranded = null;
  try {
    await switchBranch(git, { projectPath: main, branch: 'conductor-settings-local' });
  } catch (err) {
    stranded = String(err.message || err);
  }
  check('which is why git will not hand it over', !!stranded, String(stranded));

  // Nothing to leave out, and nothing to crash on.
  check('no worktrees is an empty answer', JSON.stringify(history.branchesElsewhere([], main)) === '{}');
  check('and neither is nothing at all', JSON.stringify(history.branchesElsewhere(null, main)) === '{}');

  // The refusal, for the name that reaches git anyway.
  let refused = null;
  try {
    await switchBranch(git, { projectPath: main, branch: 'background-bleu' });
  } catch (err) {
    refused = String(err.message || err);
  }
  check('switching to a branch another folder holds is refused', !!refused, String(refused));
  check(
    'and says where it is open, in the app’s words',
    !!refused && refused.includes(real(blue)) && /open in another folder/.test(refused) && !/worktree/i.test(refused),
    String(refused)
  );

  // A branch left out of the switcher because of a folder that no longer
  // exists has nowhere else to be explained, so the worktree list has to say
  // that much rather than name a folder the user would go and look for.
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'panels', 'HistoryPanel.jsx'), 'utf8');
  check(
    'the panel says when a folder is gone',
    /w\.prunable \? 'folder is gone'/.test(panel)
  );

  fs.rmSync(root, { recursive: true, force: true });

  if (failures.length) {
    console.error(`branches-elsewhere: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`branches-elsewhere: ${checked} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
