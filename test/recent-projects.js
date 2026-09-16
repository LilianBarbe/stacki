// The start screen lists projects, not the folders they were opened from.
//
//   node test/recent-projects.js
//
// Working on a project through agent workspaces means opening git worktrees of
// it: `~/conductor/workspaces/lilian-barbe/islamabad`, `…/miami`, and the
// project itself on the Desktop. Three folders, one project — and the recents
// rail used to show three cards with three different names, all of the same
// site. This checks the fold back to the repository each checkout came from.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { mainProjectPath, foldToProjects } = require('../electron/projectRoot');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

const git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
const sh = async (dir, ...args) => (await git(dir, args)).trim();

(async () => {
  // realpath because on macOS the temp directory is reached through a symlink
  // and git stores the checkout's origin resolved — a difference that belongs to
  // /tmp, not to what is being measured.
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-recents-')));
  // A repository laid out the way the real ones are: the project in one place,
  // its workspaces gathered somewhere else entirely.
  const project = path.join(tmp, 'WORKSITES', 'lilian-barbe');
  fs.mkdirSync(project, { recursive: true });
  await sh(project, 'init', '-q', '-b', 'main', '.');
  await sh(project, 'config', 'user.email', 'tim@example.com');
  await sh(project, 'config', 'user.name', 'Tim Ricks');
  fs.writeFileSync(path.join(project, 'astro.config.mjs'), 'export default {};\n');
  await sh(project, 'add', '-A');
  await sh(project, 'commit', '-qm', 'one');

  const workspaces = path.join(tmp, 'conductor', 'workspaces', 'lilian-barbe');
  const islamabad = path.join(workspaces, 'islamabad');
  const miami = path.join(workspaces, 'miami');
  await sh(project, 'worktree', 'add', '-q', '-b', 'islamabad', islamabad);
  await sh(project, 'worktree', 'add', '-q', '-b', 'miami', miami);

  // --- One folder at a time ------------------------------------------------
  check('a workspace resolves to its project', mainProjectPath(islamabad) === project, mainProjectPath(islamabad));
  check('and so does another of the same project', mainProjectPath(miami) === project, mainProjectPath(miami));
  check('the project itself is left alone', mainProjectPath(project) === project, mainProjectPath(project));

  // A folder that is no repository, and one that is not there at all: both are
  // themselves. Nothing is worth an exception on a screen that only lists.
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  check('a folder with no git is itself', mainProjectPath(plain) === plain);
  check('a folder that has gone is itself', mainProjectPath(path.join(tmp, 'nope')) === path.join(tmp, 'nope'));

  // A submodule's `.git` is a file too, and points into `.git/modules` — it is
  // not a second checkout of the project and must not be folded into one.
  const submodule = path.join(tmp, 'submodule');
  fs.mkdirSync(submodule);
  fs.writeFileSync(path.join(submodule, '.git'), `gitdir: ${project}/.git/modules/sub\n`);
  check('a submodule is itself', mainProjectPath(submodule) === submodule, mainProjectPath(submodule));

  // A workspace whose project has been deleted still opens; a tidier path that
  // is not there would not.
  const orphan = path.join(tmp, 'orphan');
  fs.mkdirSync(orphan);
  fs.writeFileSync(path.join(orphan, '.git'), `gitdir: ${tmp}/gone/.git/worktrees/orphan\n`);
  check('a workspace of a project that has gone is itself', mainProjectPath(orphan) === orphan, mainProjectPath(orphan));

  // --- The list ------------------------------------------------------------
  const other = path.join(tmp, 'WORKSITES', 'elax-2026');
  fs.mkdirSync(other, { recursive: true });
  const stored = [
    { path: islamabad, name: 'islamabad', openedAt: 5 },
    { path: miami, name: 'miami', openedAt: 4 },
    { path: project, name: 'lilian-barbe', openedAt: 3 },
    { path: other, name: 'elax-2026', openedAt: 2 },
  ];
  const folded = foldToProjects(stored, () => true);
  check('four remembered folders are two projects', folded.length === 2, JSON.stringify(folded.map((r) => r.name)));
  check('the project is named after itself, not the branch', folded[0].name === 'lilian-barbe', folded[0].name);
  check('and carries the project path', folded[0].path === project, folded[0].path);
  check('the order of visits is kept', folded[1].name === 'elax-2026', folded[1].name);
  check('an entry that needed no folding is passed through', folded[1] === stored[3]);

  // Rejected by `keep` — gone, or no longer an Astro project — is dropped, and
  // the fold happens first: what is judged is the project, not the workspace.
  const only = foldToProjects(stored, (p) => p === project);
  check('what is kept is judged by project path', only.length === 1 && only[0].path === project, JSON.stringify(only));

  for (const wt of [islamabad, miami]) {
    try {
      await git(project, ['worktree', 'remove', '--force', wt]);
    } catch {
      /* already gone */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures.length) {
    console.error(`recent-projects: ${failures.length} of ${checked} failed\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`recent-projects: ${checked} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
