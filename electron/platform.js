const path = require('node:path');
const pathAPI = (platform) => (platform === 'win32' ? path.win32 : path.posix);
function comparablePath(value, platform) {
  const resolved = pathAPI(platform).resolve(value);
  return platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function sameFilesystemPath(first, second, platform = process.platform) {
  return comparablePath(first, platform) === comparablePath(second, platform);
}
function isPathWithin(root, candidate, platform = process.platform) {
  const api = pathAPI(platform);
  const rootPath = comparablePath(root, platform);
  const candidatePath = comparablePath(candidate, platform);
  const relative = api.relative(rootPath, candidatePath);
  const isOutside =
    relative.startsWith(`..${api.sep}`) ||
    relative === '..' ||
    api.isAbsolute(relative);
  return relative === '' || !isOutside;
}
function isPathDescendant(root, candidate, platform = process.platform) {
  return (
    !sameFilesystemPath(root, candidate, platform) &&
    isPathWithin(root, candidate, platform)
  );
}
function pathEnvironmentKey(environment, platform) {
  if (platform !== 'win32') {
    return 'PATH';
  }
  return (
    Object.keys(environment).find(
      (key) => key.toLocaleLowerCase('en-US') === 'path',
    ) ?? 'Path'
  );
}
function pathEnvironmentValue(environment, platform = process.platform) {
  return environment[pathEnvironmentKey(environment, platform)] ?? '';
}
function setPathEnvironment(environment, value, platform = process.platform) {
  environment[pathEnvironmentKey(environment, platform)] = value;
}
function mergeToolPaths(current, candidates, platform = process.platform) {
  const delimiter = platform === 'win32' ? ';' : ':';
  const parts = current.split(delimiter).filter(Boolean);
  const comparable = (value) =>
    platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
  const seen = new Set(parts.map(comparable));
  for (const candidate of candidates) {
    const key = comparable(candidate);
    if (candidate && !seen.has(key)) {
      seen.add(key);
      parts.push(candidate);
    }
  }
  return parts.join(delimiter);
}
function commandNeedsShell(command, platform = process.platform) {
  return platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
}
function staticToolPathGuesses(home, environment, platform = process.platform) {
  if (platform !== 'win32') {
    return [];
  }
  const api = path.win32;
  const local =
    environment['LOCALAPPDATA'] ?? api.join(home, 'AppData', 'Local');
  const roaming =
    environment['APPDATA'] ?? api.join(home, 'AppData', 'Roaming');
  const programFiles = environment['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 =
    environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const chocolatey =
    environment['ChocolateyInstall'] ?? 'C:\\ProgramData\\chocolatey';
  return [
    environment['NVM_SYMLINK'] ?? '',
    environment['PNPM_HOME'] ?? '',
    environment['FNM_DIR'] ?? '',
    environment['BUN_INSTALL']
      ? api.join(environment['BUN_INSTALL'], 'bin')
      : '',
    api.join(programFiles, 'nodejs'),
    api.join(programFilesX86, 'nodejs'),
    api.join(programFiles, 'Git', 'cmd'),
    api.join(roaming, 'npm'),
    api.join(local, 'Volta', 'bin'),
    api.join(local, 'Programs', 'Git', 'cmd'),
    api.join(local, 'Microsoft', 'WinGet', 'Links'),
    api.join(home, '.bun', 'bin'),
    api.join(home, 'scoop', 'shims'),
    api.join(chocolatey, 'bin'),
  ].filter(Boolean);
}

module.exports = {
  sameFilesystemPath,
  isPathWithin,
  isPathDescendant,
  pathEnvironmentValue,
  setPathEnvironment,
  mergeToolPaths,
  commandNeedsShell,
  staticToolPathGuesses,
};
