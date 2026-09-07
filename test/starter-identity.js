// The first commit of a new site, on a machine git knows nothing about.
//
//   node test/starter-identity.js
//
// Starting a site ends with a commit of the scaffold, because "the history is
// theirs" is the whole reason the app runs git at all. That commit needs an
// author, and git will invent one from the username and the hostname when the
// config has none — which is why this never failed on anyone's laptop.
//
// It fails where the hostname has no domain. git gives up rather than write
// `runner@fv-az1425-231.(none)` into a commit, the failure was swallowed as
// "could not start a git history", and the site was left with a .git holding
// no commits at all — the one state the panel cannot show a history for. CI is
// such a machine, which is how it was found.
//
// So the commit is retried once under a stand-in identity. The retry happens
// only after the plain commit has already failed, so a real identity is never
// replaced by it — that ordering is what the last check here is about.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const failures = [];
let checked = 0;
const check = (what, condition, detail) => {
  checked++;
  if (!condition) failures.push(`  ${what}${detail ? `\n    ${detail}` : ''}`);
};

const SCAFFOLD = `
fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }, null, 2));
fs.writeFileSync(path.join(dir, 'src', 'pages', 'index.astro'), '<h1>Hi</h1>\\n');
console.log('Ready.');
`;

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stacki-identity-'));

  // An empty file rather than /dev/null, which Windows has no answer for.
  const emptyConfig = path.join(root, 'empty.gitconfig');
  fs.writeFileSync(emptyConfig, '');

  // useConfigOnly is how a machine that cannot name its user is reproduced on
  // one that can: it forbids git the guess, which is exactly what a domainless
  // hostname takes away from it.
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_SYSTEM = emptyConfig;
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'user.useConfigOnly';
  process.env.GIT_CONFIG_VALUE_0 = 'true';

  // Required after the env is set: starter.js reads process.env when it spawns.
  const { createStarter } = require('../electron/starter.js');

  const npm = path.join(root, 'npm-fake');
  fs.writeFileSync(
    npm,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), process.argv[4]);
${SCAFFOLD}
`,
    { mode: 0o755 }
  );

  const parent = path.join(root, 'sites');
  fs.mkdirSync(parent);

  const log = [];
  const result = await createStarter({
    npm,
    parentPath: parent,
    name: 'my-site',
    onLog: (text) => log.push(text),
  });
  const dir = path.join(parent, 'my-site');
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  check('the site was created', result?.ok === true, JSON.stringify(result));
  check('it is a git repository', fs.existsSync(path.join(dir, '.git')));

  // The bug: this threw, because there were no commits to count.
  let commits = null;
  try {
    commits = git(['rev-list', '--count', 'HEAD']);
  } catch (e) {
    commits = `no commits — ${String(e.message).split('\n')[0]}`;
  }
  check('the scaffold was committed even so', commits === '1', commits);

  if (commits === '1') {
    check(
      'under the name the site was started from',
      /Start my-site from Lumos/.test(git(['log', '-1', '--pretty=%s'])),
      git(['log', '-1', '--pretty=%s'])
    );
    check(
      'and the stand-in author is the app, not the machine',
      git(['log', '-1', '--pretty=%an']) === 'Stacki',
      git(['log', '-1', '--pretty=%an'])
    );
    check('the history is not left empty', !log.join('').includes('could not start a git history'), log.join(''));
  }

  // --- and a machine that CAN name its user keeps its own name ----------------
  // The retry is second, so it only ever runs on an identity git refused.
  const starter = fs.readFileSync(path.join(__dirname, '..', 'electron', 'starter.js'), 'utf8');
  const plain = starter.indexOf("'commit', '-m', message");
  const fallback = starter.indexOf("user.name=Stacki");
  check('the plain commit is attempted first', plain !== -1 && fallback !== -1 && plain < fallback, `${plain} vs ${fallback}`);

  if (failures.length) {
    console.error(`\nstarter-identity: ${failures.length} failed, ${checked - failures.length} passed\n`);
    console.error(failures.join('\n') + '\n');
    process.exit(1);
  }
  console.log(`starter-identity: ${checked} passed`);
})();
