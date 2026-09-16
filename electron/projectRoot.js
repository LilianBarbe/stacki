const fs = require('fs');
const path = require('path');

// The project a folder belongs to.
//
// A git worktree is the same project checked out a second time somewhere else:
// an agent's workspace under `~/conductor/workspaces/<project>/<branch>`, the
// app's own preview checkout in `.stacki/preview`, a branch somebody parked in
// a sibling folder. Opening one is opening that project, so the start screen —
// which lists projects — must not show it a second time under the branch's
// name. `lilian-barbe`, `islamabad` and `miami` are one card, not three.
//
// The fold is filesystem-only, no git process: a linked worktree's `.git` is a
// file pointing at `<repo>/.git/worktrees/<name>`, and everything before
// `/.git/` is the repository the checkout came from.

const WORKTREES = `${path.sep}.git${path.sep}worktrees${path.sep}`;

/**
 * The repository `dir` is a checkout of, or `dir` itself.
 *
 * Anything unexpected — no `.git`, a submodule's pointer, a repository that has
 * since moved away — leaves the folder as it is. A path that opens is always
 * better than a tidier one that does not.
 */
function mainProjectPath(dir) {
  try {
    const dotGit = path.join(dir, '.git');
    // A normal checkout has a `.git` directory; only a linked worktree has a file.
    if (!fs.statSync(dotGit).isFile()) return dir;
    const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    if (!pointer) return dir;
    // Relative pointers are relative to the folder holding the `.git` file.
    const gitdir = path.resolve(dir, pointer[1].trim());
    const at = gitdir.indexOf(WORKTREES);
    if (at === -1) return dir; // a submodule (`.git/modules/…`), or something new
    const root = gitdir.slice(0, at);
    return fs.existsSync(root) ? root : dir;
  } catch {
    return dir;
  }
}

/**
 * Remembered folders as the list of projects behind them.
 *
 * Order is kept — most recently opened first — so a project last reached
 * through one of its workspaces sits where that visit put it, under its own
 * name. `keep` decides what is still openable; entries it rejects are dropped
 * rather than offered and failing on the click.
 */
function foldToProjects(list, keep) {
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const root = mainProjectPath(entry.path);
    if (seen.has(root)) continue;
    seen.add(root);
    if (!keep(root)) continue;
    out.push(root === entry.path ? entry : { ...entry, path: root, name: path.basename(root) });
  }
  return out;
}

module.exports = { mainProjectPath, foldToProjects };
