// Backport https://github.com/electron-userland/electron-builder/pull/10172
// to our locked app-builder-lib 25.1.8. `security import -P` needs the
// certificate password; `set-key-partition-list -k` needs the independently
// generated keychain password. Remove this after upgrading to a fixed builder.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

const BUILDER_VERSION = '25.1.8';
const ORIGINAL_HASH = 'ab30cf9755231ef0c279fc4a13f31b405b0a88b2cab657a57604e85bbb7ebbfd';
const PATCHED_HASH = '0fd7bf220d2c45a99b06a26632f1777e16873431a2dc798477da3f9e6d0cf36d';
const hash = (source) => createHash('sha256').update(source).digest('hex');

function patchSigningSource(source) {
  const digest = hash(source);
  if (digest === PATCHED_HASH) {return source;}
  if (digest !== ORIGINAL_HASH) {
    throw new Error('Unrecognized electron-builder signing source; review the signing backport before installing.');
  }
  const patched = source
    .replace('return await importCerts(keychainFile, certPaths, cscPasswords);',
      'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);')
    .replace('async function importCerts(keychainFile, paths, keyPasswords) {',
      'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {')
    .replace('["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
      '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]');
  if (hash(patched) !== PATCHED_HASH) {throw new Error('Electron-builder signing backport failed validation.');}
  return patched;
}

function fixElectronBuilderSigning(projectDir = path.resolve(__dirname, '..')) {
  const projectRequire = createRequire(path.join(projectDir, 'package.json'));
  let builderPackage;
  try {
    builderPackage = projectRequire.resolve('electron-builder/package.json');
  } catch (error) {
    // electron-builder is a devDependency, omitted from production installs.
    if (error.code === 'MODULE_NOT_FOUND') {return 'not-installed';}
    throw error;
  }
  // Resolve from the builder itself, including non-hoisted dependency layouts.
  const libraryPackage = createRequire(builderPackage).resolve('app-builder-lib/package.json');
  const { version } = JSON.parse(fs.readFileSync(libraryPackage, 'utf8'));
  if (version !== BUILDER_VERSION) {
    throw new Error(`Unsupported app-builder-lib ${version}; review the signing backport before upgrading.`);
  }
  const file = path.join(path.dirname(libraryPackage), 'out/codeSign/macCodeSign.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchSigningSource(source);
  if (source === patched) {return 'already-patched';}

  // Validate everything before replacing the file, and publish it atomically.
  const temporary = `${file}.stacki-${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, patched, { flag: 'wx', mode: fs.statSync(file).mode & 0o777 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return 'patched';
}

module.exports = { patchSigningSource, fixElectronBuilderSigning };

if (require.main === module) {
  try {
    console.log(`  • electron-builder signing: ${fixElectronBuilderSigning()}`);
  } catch (error) {
    console.error(`  • electron-builder signing: ${error.message}`);
    process.exitCode = 1;
  }
}
