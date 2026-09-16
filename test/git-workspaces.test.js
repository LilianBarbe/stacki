const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { listWorkspaces } = require('../electron/gitWorkspaces');

const exec = promisify(execFile);
const git = (cwd, args) => exec('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } });
const isProject = (dir) => fs.existsSync(path.join(dir, 'astro.config.mjs'));

test('workspace discovery preserves paths, subprojects and isolated changes', async (t) => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-workspaces-')));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'main');
  fs.mkdirSync(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Workspace Test']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  const app = path.join(root, 'apps', 'site');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'astro.config.mjs'), 'export default {};\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'Initial']);
  const second = path.join(temp, 'équipe "design"\nworkspace');
  await git(root, ['worktree', 'add', '-qb', 'design', second]);
  const detached = path.join(temp, 'detached');
  await git(root, ['worktree', 'add', '-q', '--detach', detached]);
  const preview = path.join(root, '.stacki', 'preview');
  await git(root, ['worktree', 'add', '-q', '--detach', preview]);
  fs.writeFileSync(path.join(app, 'astro.config.mjs'), 'export default { changed: true };\n');

  const rows = await listWorkspaces(git, { projectPath: app }, isProject);
  assert.equal(rows.length, 3, 'internal previews are hidden');
  assert.equal(rows.filter((w) => w.current).length, 1);
  assert.equal(rows.find((w) => w.current).projectPath, app);
  assert.equal(rows.find((w) => w.path === second).projectPath, path.join(second, 'apps', 'site'));
  assert.equal(rows.find((w) => w.path === second).branch, 'design');
  assert.ok(rows.every((w) => w.available));
  assert.equal(rows.find((w) => w.path === detached).detached, true);

  const fromSecond = await listWorkspaces(git, { projectPath: path.join(second, 'apps', 'site') }, isProject);
  assert.equal(fromSecond.find((w) => w.current).path, second);
  assert.equal(await fs.promises.readFile(path.join(app, 'astro.config.mjs'), 'utf8'), 'export default { changed: true };\n');
  assert.equal((await git(root, ['branch', '--show-current'])).stdout.trim(), 'main');
  assert.equal(await fs.promises.readFile(path.join(second, 'apps', 'site', 'astro.config.mjs'), 'utf8'), 'export default {};\n');

  const link = path.join(temp, 'alias');
  fs.symlinkSync(app, link, 'junction');
  const aliased = await listWorkspaces(git, { projectPath: link }, isProject);
  assert.equal(aliased.find((w) => w.current).path, root, 'symlinked project is recognized');

  fs.rmSync(second, { recursive: true, force: true });
  fs.rmSync(path.join(detached, 'apps', 'site'), { recursive: true });
  const unavailable = await listWorkspaces(git, { projectPath: app }, isProject);
  assert.equal(unavailable.find((w) => w.path === second).available, false, 'removed worktree is unavailable');
  assert.equal(unavailable.find((w) => w.path === detached).available, false, 'missing subproject is unavailable');
  assert.deepEqual(await listWorkspaces(git, { projectPath: temp }, isProject), []);
});
