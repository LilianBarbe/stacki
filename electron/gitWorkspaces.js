const fs = require('fs');
const path = require('path');
const { worktrees } = require('./gitHistory');

const canonical = (dir) => {
  try { return fs.realpathSync(dir); } catch { return path.resolve(dir); }
};

// Keep the same app inside a monorepo when moving to another checkout.
async function listWorkspaces(git, { projectPath }, isProject) {
  let root;
  try {
    const { stdout } = await git(projectPath, ['rev-parse', '--show-toplevel']);
    root = stdout.replace(/\r?\n$/, '');
  } catch (err) {
    if (/not a git repository/i.test(String(err.stderr || err.message))) return [];
    throw err;
  }
  const relative = path.relative(canonical(root), canonical(projectPath));
  const entries = await worktrees(git, { projectPath });
  return entries
    .filter((w) => !w.bare && !/[\\/]\.stacki[\\/]preview$/.test(w.path))
    .map((w) => {
      const target = path.join(w.path, relative);
      return {
        ...w,
        name: path.basename(w.path),
        projectPath: target,
        current: canonical(target) === canonical(projectPath),
        available: !w.prunable && fs.existsSync(target) && isProject(target),
      };
    });
}

module.exports = { listWorkspaces };
